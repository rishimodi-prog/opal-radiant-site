import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pages = ['pricing.html', ...['', '-cost-mumbai', '-powai', '-thane', '-wadala', '-borivali'].map(suffix => 'services/hifu-face-lift' + suffix + '.html')]
for (const page of pages) {
  test(page + ': revised HIFU prices and valid structured data', () => {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8')
    assert.match(html, /14,999/)
    assert.match(html, /19,999/)
    assert.match(html, /54,999/)
    assert.match(html, /50%/)
    assert.match(html, /without neck/i)
    assert.match(html, /with neck/i)
    assert.doesNotMatch(html, /HIFU is priced per session rather than as a package|"price": "15000"|From ₹15,000|starting ₹15,000|Full face<\/strong><\/td>\s*<td>₹35,000/i)
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1])
  })
}
