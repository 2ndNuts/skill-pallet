import AppKit
import CoreGraphics
import os

struct WindowMotionVelocity {
    var x = 0.0
    var y = 0.0
}

struct WindowVelocitySampler {
    private(set) var distance = 0.0
    private var origin: CGPoint?
    private var time = 0.0
    private var velocity = WindowMotionVelocity()

    mutating func sample(origin next: CGPoint, at now: TimeInterval) -> WindowMotionVelocity {
        guard next.x.isFinite, next.y.isFinite, now.isFinite else { reset(); return velocity }
        defer { origin = next; time = now }
        guard let previous = origin else { return velocity }
        let dt = now - time, dx = Double(next.x - previous.x), dy = Double(next.y - previous.y)
        guard dt > 0, dt <= 0.15, hypot(dx, dy) <= 600 else { velocity = WindowMotionVelocity(); return velocity }
        distance += hypot(dx, dy)
        let interval = max(1.0 / 240.0, dt), blend = 1 - exp(-dt / 0.028)
        velocity.x += (dx / interval - velocity.x) * blend
        velocity.y += (dy / interval - velocity.y) * blend
        let speed = hypot(velocity.x, velocity.y)
        if speed > 1800 { velocity.x *= 1800 / speed; velocity.y *= 1800 / speed }
        if speed < 1 { velocity = WindowMotionVelocity() }
        return velocity
    }
    mutating func reset() { origin = nil; time = 0; distance = 0; velocity = WindowMotionVelocity() }
}

struct WindowMotionPacket {
    let sequence: Int
    let sample: Int
    let velocity: WindowMotionVelocity
    let distance: Double
    let dragging: Bool
    let issuedAt: TimeInterval
    var payload: [String: Any] {
        ["sequence": sequence, "sample": sample, "vx": velocity.x, "vy": velocity.y, "distance": distance,
         "dragging": dragging, "issuedAt": issuedAt * 1000]
    }
}

// Observe the application's own window. Its position comes from WindowServer,
// since NSWindow.frame can remain unchanged during the native drag session.
@MainActor final class WindowMotionRelay {
    private weak var window: NSWindow?
    private let emit: (WindowMotionPacket) -> Void
    private var observers: [NSObjectProtocol] = []
    private var timer: Timer?
    private var sampler = WindowVelocitySampler()
    private var sequence = 0, sample = 0, movedSamples = 0
    private var startedAt = 0.0, maxSpeed = 0.0
    private var distance = 0.0
    private let log = Logger(subsystem: "com.kaido.skillpalette", category: "WindowMotion")

    init(window: NSWindow, emit: @escaping (WindowMotionPacket) -> Void) {
        self.window = window; self.emit = emit
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSWindow.willMoveNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.begin() }
        })
        observers.append(center.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                if NSEvent.pressedMouseButtons & 1 == 0 { self?.stop() }
                else { self?.begin() }
            }
        })
        observers.append(center.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stop() }
        })
    }

    deinit { timer?.invalidate(); for observer in observers { NotificationCenter.default.removeObserver(observer) } }

    private func position() -> CGPoint? {
        guard let window else { return nil }
        if let list = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(window.windowNumber)) as? [[String: Any]],
           let bounds = list.first?[kCGWindowBounds as String] as? [String: Any],
           let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) { return rect.origin }
        return CGPoint(x: window.frame.minX, y: -window.frame.maxY)
    }
    private func begin() {
        guard timer == nil, let window, window.isVisible, !window.isMiniaturized,
              NSEvent.pressedMouseButtons & 1 != 0,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        sequence += 1; sample = 0; movedSamples = 0; maxSpeed = 0; distance = 0
        sampler.reset(); startedAt = ProcessInfo.processInfo.systemUptime
        if let point = position() { _ = sampler.sample(origin: point, at: startedAt) }
        send(WindowMotionVelocity(), dragging: true)
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.add(timer, forMode: .eventTracking)
    }
    private func tick() {
        guard let window, window.isVisible, !window.isMiniaturized, !NSApp.isHidden,
              NSEvent.pressedMouseButtons & 1 != 0,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              let point = position() else { stop(); return }
        let velocity = sampler.sample(origin: point, at: ProcessInfo.processInfo.systemUptime)
        distance = sampler.distance
        let speed = hypot(velocity.x, velocity.y)
        if speed > 10 { movedSamples += 1 }; maxSpeed = max(maxSpeed, speed)
        send(velocity, dragging: true)
    }
    private func send(_ velocity: WindowMotionVelocity, dragging: Bool) {
        sample += 1
        emit(WindowMotionPacket(sequence: sequence, sample: sample, velocity: velocity, distance: distance, dragging: dragging, issuedAt: Date().timeIntervalSince1970))
    }
    func stop() {
        guard timer != nil else { return }
        timer?.invalidate(); timer = nil; sampler.reset()
        send(WindowMotionVelocity(), dragging: false)
        let duration = ProcessInfo.processInfo.systemUptime - startedAt
        log.info("drag complete: samples=\(self.sample, privacy: .public) moved=\(self.movedSamples, privacy: .public) duration=\(duration, privacy: .public) maxSpeed=\(self.maxSpeed, privacy: .public)")
    }
}

func windowMotionSelfTest() {
    var sampler = WindowVelocitySampler()
    precondition(sampler.sample(origin: .zero, at: 0).x == 0)
    let moving = sampler.sample(origin: CGPoint(x: 16, y: 8), at: 0.016)
    precondition(moving.x > 0 && moving.y > 0)
    precondition(abs(sampler.distance - hypot(16, 8)) < 0.0001)
    let reverse = sampler.sample(origin: CGPoint(x: -16, y: -8), at: 0.032)
    precondition(reverse.x < 0 && reverse.y < 0)
    let paused = sampler.sample(origin: CGPoint(x: 400, y: 400), at: 1)
    precondition(paused.x == 0 && paused.y == 0)
    let teleported = sampler.sample(origin: CGPoint(x: 4000, y: 4000), at: 1.016)
    precondition(teleported.x == 0 && teleported.y == 0)
    sampler.reset()
    _ = sampler.sample(origin: .zero, at: 2)
    let fast = sampler.sample(origin: CGPoint(x: 300, y: 300), at: 2.001)
    precondition(hypot(fast.x, fast.y) <= 1800.0001)
    for index in 1...30 { _ = sampler.sample(origin: CGPoint(x: 300, y: 300), at: 2.001 + Double(index) / 60) }
    let idle = sampler.sample(origin: CGPoint(x: 300, y: 300), at: 2.6)
    precondition(idle.x == 0 && idle.y == 0)
    print("PASS: window motion samples the drag direction, damps velocity, caps speed and discards pauses or screen jumps")
}
