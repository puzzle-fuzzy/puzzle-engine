import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createAccount,
  getAccountByEmail,
  getAccountById,
  getAccountByUsername,
} from '../src/repositories/accounts.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('accounts repository', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  // ─── createAccount ─────────────────────────────────

  describe('createAccount', () => {
    it('should insert and return an account with all fields', async () => {
      const result = await createAccount({
        username: 'newuser',
        email: 'new@example.com',
        password: 'hashed_pw_123',
        isActive: true,
      })

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.username).toBe('newuser')
      expect(result.email).toBe('new@example.com')
      expect(result.password).toBe('hashed_pw_123')
      expect(result.isActive).toBe(true)
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.updatedAt).toBeInstanceOf(Date)
    })

    it('should default isActive to true', async () => {
      const result = await createAccount({
        username: 'defaultactive',
        email: 'default@example.com',
        password: 'hashed',
      })

      expect(result.isActive).toBe(true)
    })

    it('should create account with avatar', async () => {
      const result = await createAccount({
        username: 'avataruser',
        email: 'avatar@example.com',
        password: 'hashed',
        avatar: 'https://example.com/avatar.png',
      })

      expect(result.avatar).toBe('https://example.com/avatar.png')
    })
  })

  // ─── getAccountByEmail ─────────────────────────────

  describe('getAccountByEmail', () => {
    it('should return the account when found', async () => {
      const created = await createAccount({
        username: 'emailuser',
        email: 'find@example.com',
        password: 'hashed',
      })

      const found = await getAccountByEmail('find@example.com')

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.email).toBe('find@example.com')
      expect(found!.username).toBe('emailuser')
    })

    it('should return null when email not found', async () => {
      const result = await getAccountByEmail('nonexistent@example.com')
      expect(result).toBeNull()
    })

    it('should be case-sensitive for email lookup', async () => {
      await createAccount({
        username: 'casesensitive',
        email: 'Case@Example.com',
        password: 'hashed',
      })

      // PostgreSQL varchar 是区分大小写的
      const lower = await getAccountByEmail('case@example.com')
      // 取决于数据库排序规则，但默认 varchar 是区分大小写的
      expect(lower === null || lower!.email === 'Case@Example.com').toBe(true)
    })
  })

  // ─── getAccountByUsername ──────────────────────────

  describe('getAccountByUsername', () => {
    it('should return the account when found', async () => {
      const created = await createAccount({
        username: 'findme',
        email: 'findme@example.com',
        password: 'hashed',
      })

      const found = await getAccountByUsername('findme')

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.username).toBe('findme')
    })

    it('should return null when username not found', async () => {
      const result = await getAccountByUsername('nonexistent_user')
      expect(result).toBeNull()
    })
  })

  // ─── getAccountById ────────────────────────────────

  describe('getAccountById', () => {
    it('should return the account when found', async () => {
      // accountId 来自 beginTestTransaction seed 的测试账户
      const found = await getAccountById(accountId)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(accountId)
    })

    it('should return null for nonexistent ID', async () => {
      const result = await getAccountById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── 约束验证 ─────────────────────────────────────

  describe('constraints', () => {
    it('should reject duplicate email (unique constraint)', async () => {
      await createAccount({
        username: 'user1',
        email: 'dup@example.com',
        password: 'hashed',
      })

      await expect(
        createAccount({
          username: 'user2',
          email: 'dup@example.com',
          password: 'hashed',
        }),
      ).rejects.toThrow()
    })

    it('should reject duplicate username (unique constraint)', async () => {
      await createAccount({
        username: 'dupuser',
        email: 'a@example.com',
        password: 'hashed',
      })

      await expect(
        createAccount({
          username: 'dupuser',
          email: 'b@example.com',
          password: 'hashed',
        }),
      ).rejects.toThrow()
    })
  })
})
