import { act, q, ADMIN_EMAIL, ADMIN_PASSWORD, mut, uploadImage } from './lib.mjs'

const token = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})

async function safeCall(name, args, token_) {
  try { return { ok: true, value: await q(name, args, token_) } }
  catch (e) { return { ok: false, name, error: e.message.slice(0, 300), args, argsType: typeof args } }
}
const rows = [
  ['listQuestionCategories', {}],
  ['listQuestionTopics', {}],
  ['listQuestionTypes', {}],
  ['listQuestions', {}],
  ['listExams', {}],
  ['listAdminAssessments', {}],
  ['getAdminDashboard', {}],
  ['listInstitutions', {}],
  ['listTeachingCenters', {}],
  ['listGovernmentFacilities', {}],
  ['listInstructors', {}],
  ['listStudents', {}],
  ['listClasses', {}],
]
for (const [name, args] of rows) {
  console.log(JSON.stringify({ name, args, rt: await safeCall(name, args, token.tokens.token ?? null) }))
}
