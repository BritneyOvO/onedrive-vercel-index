import Redis from 'ioredis'
import siteConfig from '../../config/site.config'

// Persistent key-value store is provided by Redis, hosted on Upstash/Vercel KV.
// Supported envs, in priority order:
// - KV_REST_API_URL + KV_REST_API_TOKEN       (Vercel KV)
// - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// - REDIS_URL                                 (Redis protocol URL)
let kv: Redis | null = null

type RestConfig = {
  url: string
  token: string
}

function prefixedKey(key: string) {
  return `${siteConfig.kvPrefix}${key}`
}

function getRestConfig(): RestConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

async function runRestCommand(command: Array<string | number>): Promise<unknown> {
  const config = getRestConfig()
  if (!config) {
    throw new Error('REST Redis storage is not configured.')
  }

  const path = command.map(part => encodeURIComponent(String(part))).join('/')
  const response = await fetch(`${config.url}/${path}`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || data?.error) {
    throw new Error(data?.error ?? `Redis REST command failed with status ${response.status}`)
  }

  return data?.result ?? null
}

function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return null
  }

  if (!kv) {
    kv = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
    })
  }

  return kv
}

function storageNotConfiguredMessage() {
  return 'No Redis token storage configured. Set REDIS_URL, or set KV_REST_API_URL + KV_REST_API_TOKEN, or set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel environment variables.'
}

export async function getOdAuthTokens(): Promise<{ accessToken: unknown; refreshToken: unknown }> {
  const restConfig = getRestConfig()
  if (restConfig) {
    try {
      const accessToken = await runRestCommand(['get', prefixedKey('access_token')])
      const refreshToken = await runRestCommand(['get', prefixedKey('refresh_token')])
      return { accessToken, refreshToken }
    } catch (error) {
      console.error('Failed to read OAuth tokens from Redis REST storage.', error)
      return { accessToken: null, refreshToken: null }
    }
  }

  const client = getRedisClient()
  if (!client) {
    console.warn(storageNotConfiguredMessage())
    return {
      accessToken: null,
      refreshToken: null,
    }
  }

  try {
    const accessToken = await client.get(prefixedKey('access_token'))
    const refreshToken = await client.get(prefixedKey('refresh_token'))

    return {
      accessToken,
      refreshToken,
    }
  } catch (error) {
    console.error('Failed to read OAuth tokens from Redis.', error)
    return {
      accessToken: null,
      refreshToken: null,
    }
  }
}

export async function storeOdAuthTokens({
  accessToken,
  accessTokenExpiry,
  refreshToken,
}: {
  accessToken: string
  accessTokenExpiry: number
  refreshToken: string
}): Promise<void> {
  const restConfig = getRestConfig()
  if (restConfig) {
    await runRestCommand(['set', prefixedKey('access_token'), accessToken, 'EX', accessTokenExpiry])
    await runRestCommand(['set', prefixedKey('refresh_token'), refreshToken])
    return
  }

  const client = getRedisClient()
  if (!client) {
    throw new Error(storageNotConfiguredMessage())
  }

  await client.set(prefixedKey('access_token'), accessToken, 'EX', accessTokenExpiry)
  await client.set(prefixedKey('refresh_token'), refreshToken)
}
