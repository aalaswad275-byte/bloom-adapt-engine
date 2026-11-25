import { act, q, ADMIN_EMAIL, ADMIN_PASSWORD } from './lib.mjs'

const token = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})
console.log('token', token?.tokens?.token?.length ?? 0)
console.log('value', token)
const rawBody = token && await q('adminAnalytics:listAuditLogs', { limit: 1 }, token.tokens.token)
console.log('listAuditLogs', JSON.stringify(rawBody).slice(0, 400))
