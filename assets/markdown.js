/* Small, purpose-built renderer for this course's Markdown documents. */
(function () {
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = value => escape(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  const headingId = text => {
    const lower = text.toLowerCase()
    if (lower.includes('tool result')) return 'tool-result'
    if (lower.includes('tool call')) return 'tool-call'
    if (lower.includes('取消') || lower.includes('cancellation')) return 'cancellation'
    if (lower.includes('安全') || lower.includes('security')) return 'security-boundary'
    if (lower.includes('session') || lower.includes('会话')) return 'session'
    if (lower.includes('组件') || lower.includes('component')) return 'components'
    if (lower.includes('总览') || lower.includes('overview') || lower.includes('完整链路')) return 'overview'
    return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
  }
  function render(source) {
    const lines = source.replace(/\r/g, '').split('\n')
    const output = []; let i = 0; let inCode = false; let code = []; let list = null
    const closeList = () => { if (list) { output.push(`</${list}>`); list = null } }
    while (i < lines.length) {
      const line = lines[i]
      if (line.startsWith('```')) { closeList(); if (!inCode) { inCode = true; code = [] } else { output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); inCode = false } i++; continue }
      if (inCode) { code.push(line); i++; continue }
      if (!line.trim()) { closeList(); i++; continue }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line)
      if (heading) { closeList(); const level = heading[1].length; const text = heading[2]; const id = headingId(text); output.push(`<h${level} id="${id}">${inline(text)}</h${level}>`); i++; continue }
      if (line.startsWith('> ')) { closeList(); output.push(`<blockquote class="callout">${inline(line.slice(2))}</blockquote>`); i++; continue }
      if (/^[-*]\s+/.test(line)) { if (list !== 'ul') { closeList(); list = 'ul'; output.push('<ul>') } output.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`); i++; continue }
      if (/^\d+\.\s+/.test(line)) { if (list !== 'ol') { closeList(); list = 'ol'; output.push('<ol>') } output.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`); i++; continue }
      if (line.includes('|') && lines[i + 1]?.match(/^\|?\s*[-:]+/)) {
        closeList(); const cells = row => row.replace(/^\||\|$/g, '').split('|').map(v => v.trim()); const heads = cells(line); i += 2; const rows = []
        while (i < lines.length && lines[i].includes('|')) { rows.push(cells(lines[i])); i++ }
        output.push(`<table><thead><tr>${heads.map(v => `<th>${inline(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${inline(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue
      }
      closeList(); output.push(`<p>${inline(line)}</p>`); i++
    }
    closeList(); return output.join('\n')
  }
  window.renderCourseMarkdown = async function (target) {
    const source = await fetch(target.dataset.markdown).then(response => { if (!response.ok) throw new Error('Document unavailable'); return response.text() })
    target.innerHTML = render(source)
  }
})()