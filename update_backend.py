import sys

content = open('public/backend.html').read()

sidebar_search = """      <div class="mall-link">
        <a href="/" class="nav-link" style="color: var(--success);">🏠 View Mall</a>
      </div>"""

sidebar_replace = """      <div class="mall-link">
        <a href="/" class="nav-link" style="color: var(--success);">🏠 View Mall</a>
      </div>
      <div style="margin-top: 2rem; padding: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--text-muted);">
        <p style="color: var(--text-accent); font-weight: 700; margin-bottom: 0.5rem;">Support</p>
        <p>Email: wokman@dspng.tech</p>
        <p>Phone: (675) 8300 99881</p>
        <p>WhatsApp: (675) 8300 99881</p>
        <p>Text: (675) 8300 9881</p>
      </div>"""

content = content.replace(sidebar_search, sidebar_replace)

with open('public/backend.html', 'w') as f:
    f.write(content)
