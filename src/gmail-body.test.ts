import { describe, expect, test } from 'bun:test'
import { extractMessageBody } from './gmail'

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64url')

describe('extractMessageBody', () => {
  test('multipart message with text/plain and text/html parts → both extracted', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Hello plain') } },
        { mimeType: 'text/html', body: { data: b64('<p>Hello <b>html</b></p>') } },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({
      text: 'Hello plain',
      html: '<p>Hello <b>html</b></p>',
      attachments: [],
    })
  })

  test('html-only email → html extracted, text null', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/html', body: { data: b64('<p>Only html</p>') } }],
    }
    expect(extractMessageBody(payload)).toEqual({ text: null, html: '<p>Only html</p>', attachments: [] })
  })

  test('nested parts (multipart/alternative inside multipart/mixed) → recurses correctly', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Nested plain') } },
            { mimeType: 'text/html', body: { data: b64('<p>Nested html</p>') } },
          ],
        },
        { mimeType: 'image/png', body: { data: b64('fake-image-bytes') } },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({
      text: 'Nested plain',
      html: '<p>Nested html</p>',
      attachments: [],
    })
  })

  test('attachment parts (image/png with data) are ignored', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'image/png', body: { data: b64('fake-image-bytes') } },
        { mimeType: 'application/pdf', body: { data: b64('fake-pdf-bytes') } },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({ text: null, html: null, attachments: [] })
  })

  test('top-level payload.body (non-multipart case) is decoded', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: b64('Simple single-part message') },
    }
    expect(extractMessageBody(payload)).toEqual({ text: 'Simple single-part message', html: null, attachments: [] })
  })

  test('empty or absent data → null', () => {
    expect(extractMessageBody({ mimeType: 'text/plain', body: {} })).toEqual({ text: null, html: null, attachments: [] })
    expect(extractMessageBody({ mimeType: 'text/plain' })).toEqual({ text: null, html: null, attachments: [] })
    expect(extractMessageBody({ mimeType: 'text/plain', body: { data: b64('') } })).toEqual({ text: null, html: null, attachments: [] })
  })

  test('multiple same-type parts are concatenated', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('part one ') } },
        { mimeType: 'text/plain', body: { data: b64('part two') } },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({ text: 'part one part two', html: null, attachments: [] })
  })

  test('part with attachmentId (non-inline) → attachment entry with inline false', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
          body: { attachmentId: 'ATT1', size: 123 },
        },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({
      text: null,
      html: null,
      attachments: [
        { filename: 'doc.pdf', mimeType: 'application/pdf', attachmentId: 'ATT1', size: 123, inline: false },
      ],
    })
  })

  test('inline image part with Content-ID header → inline true with stripped contentId', () => {
    const payload = {
      mimeType: 'multipart/related',
      parts: [
        {
          mimeType: 'image/png',
          filename: 'image001.png',
          headers: [{ name: 'Content-ID', value: '<ii_img1@mail.gmail.com>' }],
          body: { attachmentId: 'ATT2' },
        },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({
      text: null,
      html: null,
      attachments: [
        {
          filename: 'image001.png',
          mimeType: 'image/png',
          attachmentId: 'ATT2',
          size: 0,
          contentId: 'ii_img1@mail.gmail.com',
          inline: true,
        },
      ],
    })
  })

  test('mixed: text/plain + html + one attachment → text and html extracted, attachments has only the attachment', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Mixed plain') } },
            { mimeType: 'text/html', body: { data: b64('<p>Mixed <b>html</b></p>') } },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'invoice.pdf',
          body: { attachmentId: 'ATT3', size: 456 },
        },
      ],
    }
    expect(extractMessageBody(payload)).toEqual({
      text: 'Mixed plain',
      html: '<p>Mixed <b>html</b></p>',
      attachments: [
        { filename: 'invoice.pdf', mimeType: 'application/pdf', attachmentId: 'ATT3', size: 456, inline: false },
      ],
    })
  })
})
