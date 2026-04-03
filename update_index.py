import sys

content = open('public/index.html').read()

css_search = """    .acc-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
  </style>
</head>"""

css_replace = """    .acc-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }

    .footer {
      background: var(--bg-header);
      border-top: 1px solid var(--border);
      padding: 2rem 1rem;
      text-align: center;
      margin-top: 2rem;
    }
    .footer h4 { color: var(--text-accent); margin-bottom: 1rem; }
    .footer p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
    .footer a { color: var(--primary); text-decoration: none; }
  </style>
</head>"""

footer_search = """    </div>
  </main>"""

footer_replace = """    </div>

    <footer class="footer">
      <h4>Contact Support</h4>
      <p>Email: <a href="mailto:wokman@dspng.tech">wokman@dspng.tech</a></p>
      <p>Phone: (675) 8300 99881</p>
      <p>WhatsApp: <a href="https://wa.me/675830099881">(675) 8300 99881</a></p>
      <p>Text: (675) 8300 9881</p>
      <p style="margin-top: 1rem; font-size: 0.75rem;">&copy; 2024 Unity Mall SME centre. All rights reserved.</p>
    </footer>
  </main>"""

content = content.replace(css_search, css_replace)
content = content.replace(footer_search, footer_replace)

with open('public/index.html', 'w') as f:
    f.write(content)
