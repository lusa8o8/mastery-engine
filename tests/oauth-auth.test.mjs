import assert from 'node:assert/strict'
import test from 'node:test'
import { URL } from 'node:url'

import {
  buildGoogleOAuthRedirectUrl,
  hasOAuthCallbackError,
  locationToReturnPath,
  sanitizeAuthReturnPath
} from '../src/utils/authRedirect.js'

test('auth return paths preserve known Atlas destinations', () => {
  assert.equal(sanitizeAuthReturnPath('/home'), '/home')
  assert.equal(sanitizeAuthReturnPath('/simulate/exam-1?review=true#q2'), '/simulate/exam-1?review=true#q2')
  assert.equal(
    locationToReturnPath({ pathname: '/engine/topic', search: '?objective=one', hash: '#attempt' }),
    '/engine/topic?objective=one#attempt'
  )
})

test('auth return paths reject external, ambiguous and auth-loop destinations', () => {
  const rejected = [
    null,
    '',
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example/steal',
    '/auth',
    '/unknown'
  ]

  for (const value of rejected) {
    assert.equal(sanitizeAuthReturnPath(value), '/home')
  }
})

test('Google OAuth callback uses the current origin and an encoded safe return path', () => {
  const callback = new URL(buildGoogleOAuthRedirectUrl(
    'https://atlas.example/app',
    '/patterns?tab=structure'
  ))

  assert.equal(callback.origin, 'https://atlas.example')
  assert.equal(callback.pathname, '/auth')
  assert.equal(callback.searchParams.get('next'), '/patterns?tab=structure')
})

test('Google OAuth callback rejects non-web origins', () => {
  assert.throws(
    () => buildGoogleOAuthRedirectUrl('javascript:alert(1)', '/home'),
    /HTTP or HTTPS/
  )
})

test('OAuth callback errors are detected in query strings and fragments', () => {
  assert.equal(hasOAuthCallbackError('?error=access_denied', ''), true)
  assert.equal(hasOAuthCallbackError('', '#error_code=unexpected_failure'), true)
  assert.equal(hasOAuthCallbackError('?next=%2Fhome', '#access_token=redacted'), false)
})
