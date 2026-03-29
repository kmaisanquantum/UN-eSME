import re

with open('public/index.html', 'r') as f:
    content = f.read()

# Update openCheckoutModal to populate fields if logged in
checkout_logic = """    function openCheckoutModal() {
      if (cart.length === 0) return;
      const user = JSON.parse(localStorage.getItem('um_user'));
      if (user) {
        document.getElementById('custName').value = user.name || '';
        document.getElementById('custPhone').value = user.phone || '';
      }
      document.getElementById('checkoutModal').classList.add('show');
    }"""

content = re.sub(r'    function openCheckoutModal\(\) \{.*?    \}', checkout_logic, content, flags=re.DOTALL)

with open('public/index.html', 'w') as f:
    f.write(content)
