import { act, q, mut, ADMIN_EMAIL, ADMIN_PASSWORD, FACE_POSES } from './lib.mjs'
import { nanoid } from 'nanoid'
import { load, save, log } from './lib.mjs'

const state = load()

const admin = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, token: null }
const res = await act('auth:signIn', { provider: 'password', params: { email: admin.email, password: admin.password, flow: 'signIn' } })
admin.token = res?.tokens?.token ?? null
console.log('admin token', (admin.token ?? '').length)

const courses = await q('adminCourses:listCourses', {}, admin.token)
console.log('courses', courses?.length ?? 0)
