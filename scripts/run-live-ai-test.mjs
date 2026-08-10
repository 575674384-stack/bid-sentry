/* global URL, console, process, fetch */
import { readFile } from 'node:fs/promises'

const path = new URL('../test-apikey.md', import.meta.url)
const source = await readFile(path, 'utf8')
const baseUrl = source.match(/Base URL:\s*`([^`]+)`/u)?.[1]
const apiKey = source.match(/API Key:\s*`([^`]+)`/u)?.[1]
const models = [
  source.match(/Preferred model:\s*`([^`]+)`/u)?.[1],
  source.match(/Alternate model:\s*`([^`]+)`/u)?.[1]
].filter(Boolean)
if (!baseUrl || !apiKey || models.length === 0) {
  console.log('AI live test skipped: test-apikey.md is missing required fields.')
  process.exit(0)
}

const headers = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }
const modelResponse = await fetch(`${baseUrl}/models`, { headers, redirect: 'error' }).catch(
  () => null
)
if (!modelResponse?.ok) {
  console.log(`AI live test failed: /models HTTP ${modelResponse?.status ?? 'network-error'}`)
  process.exitCode = 1
} else {
  let passed = false
  for (const model of models) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: 'Return exactly JSON: {"findings":[]}' }],
        response_format: { type: 'json_object' }
      }),
      redirect: 'error'
    }).catch(() => null)
    if (!response?.ok) continue
    try {
      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      const parsed = typeof content === 'string' ? JSON.parse(content) : null
      if (parsed && Array.isArray(parsed.findings)) {
        passed = true
        break
      }
    } catch {
      // Try the alternate model without printing its response.
    }
  }
  console.log(
    passed
      ? 'AI live test passed: models and JSON chat contract compatible.'
      : 'AI live test failed: no configured model returned the JSON contract.'
  )
  if (!passed) process.exitCode = 1
}
