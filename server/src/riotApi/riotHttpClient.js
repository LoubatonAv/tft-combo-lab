export class RiotApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RiotApiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable === true;
    this.attempts = options.attempts ?? 1;
  }
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function safeEndpoint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "Riot API endpoint";
  }
}

export class RiotHttpClient {
  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    random = Math.random,
    now = Date.now,
    maxRetries = 3,
    baseDelayMs = 250,
    maxBackoffMs = 5000,
  } = {}) {
    if (!apiKey || !String(apiKey).trim()) {
      throw new Error("RIOT_API_KEY is required.");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("A fetch implementation is required.");
    }

    this.apiKey = String(apiKey).trim();
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.random = random;
    this.now = now;
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.baseDelayMs = Math.max(1, Number(baseDelayMs) || 250);
    this.maxBackoffMs = Math.max(
      this.baseDelayMs,
      Number(maxBackoffMs) || 5000,
    );
  }

  backoffMilliseconds(retryNumber) {
    const exponential = Math.min(
      this.maxBackoffMs,
      this.baseDelayMs * 2 ** retryNumber,
    );
    const jitter = 0.75 + Math.max(0, Math.min(1, this.random())) * 0.5;
    return Math.round(exponential * jitter);
  }

  async requestJson(url) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response;

      try {
        response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "X-Riot-Token": this.apiKey,
          },
        });
      } catch (error) {
        lastError = new RiotApiError(
          `Network failure while requesting ${safeEndpoint(url)}.`,
          {
            retryable: true,
            attempts: attempt + 1,
            cause: error,
          },
        );

        if (attempt >= this.maxRetries) throw lastError;
        await this.sleep(this.backoffMilliseconds(attempt));
        continue;
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch (error) {
          throw new RiotApiError(
            `Riot API returned invalid JSON for ${safeEndpoint(url)}.`,
            { status: response.status, attempts: attempt + 1, cause: error },
          );
        }
      }

      const retryable = response.status === 429 || response.status >= 500;
      lastError = new RiotApiError(
        `Riot API request failed with HTTP ${response.status} at ${safeEndpoint(url)}.`,
        {
          status: response.status,
          retryable,
          attempts: attempt + 1,
        },
      );

      if (!retryable || attempt >= this.maxRetries) throw lastError;

      const retryAfter = retryAfterMilliseconds(
        response.headers?.get?.("retry-after"),
        this.now(),
      );
      const delay = Math.max(
        retryAfter ?? 0,
        this.backoffMilliseconds(attempt),
      );
      await this.sleep(delay);
    }

    throw lastError;
  }
}

