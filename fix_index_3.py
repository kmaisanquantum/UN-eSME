import re

with open('public/index.html', 'r') as f:
    content = f.read()

# Update social buttons to have unique IDs and call socialLogin
content = content.replace("onclick=\"alert('Google Login coming soon')\"", "onclick=\"socialLogin('google')\"")
content = content.replace("onclick=\"alert('Facebook Login coming soon')\"", "onclick=\"socialLogin('facebook')\"")

# New JS logic for social login and session check
new_js = """
    // Customer Session Management
    function checkUserSession() {
      const user = JSON.parse(localStorage.getItem('um_user'));
      const headerActions = document.querySelector('.header-actions');
      const signInBtn = headerActions.querySelector('button[onclick="openAuthModal(\\'login\\')"]');
      const signUpBtn = headerActions.querySelector('button[onclick="openAuthModal(\\'register\\')"]');

      if (user) {
        if (signInBtn) signInBtn.style.display = 'none';
        if (signUpBtn) signUpBtn.style.display = 'none';

        // Add User Profile button
        if (!document.getElementById('userProfileBtn')) {
           const profileBtn = document.createElement('button');
           profileBtn.id = 'userProfileBtn';
           profileBtn.className = 'auth-btn';
           profileBtn.style.background = 'transparent';
           profileBtn.style.border = '1px solid var(--text-accent)';
           profileBtn.style.color = 'var(--text-accent)';
           profileBtn.innerHTML = `👤 ${user.name.split(' ')[0]}`;
           profileBtn.onclick = () => {
             if (confirm('Sign out?')) {
               localStorage.removeItem('um_user');
               location.reload();
             }
           };
           headerActions.appendChild(profileBtn);
        }
      }
    }

    async function socialLogin(provider) {
      // Mock social data for demonstration
      const mockData = {
        google: { name: 'Google User', email: 'google@example.com', id: 'g123' },
        facebook: { name: 'Facebook User', email: 'fb@example.com', id: 'f456' }
      };

      const payload = {
        provider,
        ...mockData[provider]
      };

      try {
        const res = await fetch('/api/auth/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        localStorage.setItem('um_user', JSON.stringify(data.user));
        alert(`Logged in with ${provider.charAt(0).toUpperCase() + provider.slice(1)}!`);
        closeAuthModal();
        checkUserSession();
      } catch (err) {
        alert(err.message);
      }
    }

    // Call checkUserSession on init
"""

# Inject checkUserSession call in init
content = content.replace("init();", "checkUserSession(); init();")

# Append new JS to script tag
content = content.replace("init();\n  </script>", new_js + "\n    init();\n  </script>")

with open('public/index.html', 'w') as f:
    f.write(content)
