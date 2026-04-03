import sys

content = open('public/admin.html').read()

admin_search = """    </div>
  </div>

  <script>"""

admin_replace = """    </div>

    <div class="card" style="max-width: 100%; text-align: center; margin-top: 2rem;">
      <h3 style="color: var(--text-accent); margin-bottom: 1rem;">System Support</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem;">Email: wokman@dspng.tech | Phone: (675) 8300 99881 | WhatsApp: (675) 8300 99881 | Text: (675) 8300 9881</p>
    </div>
  </div>

  <script>"""

content = content.replace(admin_search, admin_replace)

with open('public/admin.html', 'w') as f:
    f.write(content)
