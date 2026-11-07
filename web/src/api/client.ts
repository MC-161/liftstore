import { fromJson, type DescMessage, type MessageShape } from '@bufbuild/protobuf'

// The gateway's error envelope. 4xx messages are the engine's own wording and
// are shown as-is: the fail-loud chain exists so the user learns the real limit.
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
  get engineDown() {
    return this.status === 503 || this.status === 502 || this.status === 0
  }
}

export async function get<D extends DescMessage>(
  schema: D,
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<MessageShape<D>> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v))

  let res: Response
  try {
    res = await fetch(`/api/${path}?${qs}`)
  } catch {
    throw new ApiError(0, 'unavailable', 'The gateway is not reachable.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const e = body?.error
    // Vite's proxy answers 500/502 with no envelope when the gateway is down.
    if (!e) throw new ApiError(res.status === 500 ? 503 : res.status, 'unavailable', 'The engine is not reachable.')
    throw new ApiError(res.status, e.code, e.message)
  }
  // fromJson, not a cast: an unknown field or a wrong enum name throws here,
  // which is where a proto/gateway drift should surface.
  return fromJson(schema, body, { ignoreUnknownFields: false })
}
