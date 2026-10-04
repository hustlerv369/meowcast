import { streamCompletion } from "./streamCompletion";

export const streamAnthropic: typeof streamCompletion = (fetcher, options, controller, emit, timeout) =>
    streamCompletion(fetcher, { ...options, protocol: "anthropic" }, controller, emit, timeout);
