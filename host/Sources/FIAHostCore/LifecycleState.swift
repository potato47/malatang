public enum ShutdownAction: Equatable, Sendable {
    case none
    case sendShutdown
    case sendSIGTERM
    case sendSIGKILL
    case complete
}

public struct ShutdownStateMachine: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        case running
        case gracefulWait
        case sigtermWait
        case stopped
    }

    public private(set) var state: State = .running

    public init() {}

    public mutating func requestStop() -> ShutdownAction {
        guard state == .running else { return .none }
        state = .gracefulWait
        return .sendShutdown
    }

    public mutating func timeout() -> ShutdownAction {
        switch state {
        case .running, .stopped:
            return .none
        case .gracefulWait:
            state = .sigtermWait
            return .sendSIGTERM
        case .sigtermWait:
            state = .stopped
            return .sendSIGKILL
        }
    }

    public mutating func processExited() -> ShutdownAction {
        guard state != .stopped else { return .none }
        state = .stopped
        return .complete
    }
}

