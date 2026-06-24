import Redis from 'ioredis'
import siteConfig from '../../config/site.config'

// Persistent key-value store is provided by Redis, hosted on Upstash
// https://vercel.com/integrations/upstash
let kv: Redis | null = null

function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.warn('REDIS_URL is not configured. OAuth tokens cannot be read or stored.')
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

export async function getOdAuthTokens(): Promise<{ accessToken: unknown; refreshToken: unknown }> {
  const client = getRedisClient()
  if (!client) {
    return {
      accessToken: null,
      refreshToken: null,
    }
  }

  try {
    const accessToken = await client.get(`${siteConfig.kvPrefix}access_token`)
    const refreshToken = await client.get(`${siteConfig.kvPrefix}refresh_token`)

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
  const client = getRedisClient()
  if (!client) {
    throw new Error('REDIS_URL is not configured. Please add an Upstash Redis REDIS_URL in Vercel env variables.')
  }

  await client.set(`${siteConfig.kvPrefix}access_token`, accessToken, 'EX', accessTokenExpiry)
  await client.set(`${siteConfig.kvPrefix}refresh_token`, refreshToken)
}
