const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Starting End-to-End Verification...');

  // Reset database before E2E run to ensure a predictable environment
  if (fs.existsSync('unity_mall.db')) {
    fs.unlinkSync('unity_mall.db');
    console.log('Cleared existing unity_mall.db');
  }

  // Start server
  const server = spawn('node', ['server.js'], { stdio: 'inherit' });

  // Wait 3 seconds for server to boot up
  await new Promise(resolve => setTimeout(resolve, 3000));

  const BASE_URL = 'http://localhost:3001';

  try {
    // -------------------------------------------------------------
    // Part B Verification: Curated categories endpoint
    // -------------------------------------------------------------
    console.log('\n--- VERIFYING CATEGORIES ENDPOINT (Part B) ---');
    const catRes = await fetch(`${BASE_URL}/api/categories`);
    const categories = await catRes.json();
    console.log('Categories:', categories);
    const expectedCategories = [
      "Retail", "Food and Beverage", "Fashion", "Beauty and Personal Care",
      "Electronics and Technology", "Mobile Phones and Accessories",
      "Repairs and Services", "Professional Services", "Health and Wellness", "Other"
    ];
    for (const cat of expectedCategories) {
      if (!categories.includes(cat)) {
        throw new Error(`Missing category: ${cat}`);
      }
    }
    console.log('✅ Part B Success: All curated categories returned successfully.');

    // -------------------------------------------------------------
    // Setup: Register and Login a fresh Vendor
    // -------------------------------------------------------------
    console.log('\n--- SETTING UP VENDOR FOR TESTING ---');
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unity Boutique',
        category: 'Fashion',
        phone: '67570000001',
        location: 'Level 1, Shop 12',
        email: 'boutique@unity.com',
        password: 'password123'
      })
    });
    const regData = await registerRes.json();
    console.log('Register Response:', regData);
    if (!regData.id) {
      throw new Error('Registration failed');
    }
    const vendor_id = regData.id;

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'boutique@unity.com',
        password: 'password123'
      })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('Login Response:', loginData.message);
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // -------------------------------------------------------------
    // Part C Verification: Save/resume onboarding API
    // -------------------------------------------------------------
    console.log('\n--- VERIFYING ONBOARDING SAVE/RESUME (Part C) ---');
    // GET initial state
    const getInitial = await fetch(`${BASE_URL}/api/onboarding`, { headers });
    const initialState = await getInitial.json();
    console.log('Initial State:', initialState);
    if (initialState.current_step !== 1 || initialState.completed !== 0) {
      throw new Error('Expected default step 1 and completed 0 state');
    }

    // Save partial onboarding state
    const putRes = await fetch(`${BASE_URL}/api/onboarding`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        current_step: 3,
        data: { step1_done: true, owner_name: 'Sarah' },
        completed: 0
      })
    });
    console.log('PUT Response:', await putRes.json());

    // GET onboarding state back
    const getUpdated = await fetch(`${BASE_URL}/api/onboarding`, { headers });
    const updatedState = await getUpdated.json();
    console.log('Updated State:', updatedState);
    if (updatedState.current_step !== 3 || updatedState.data.owner_name !== 'Sarah') {
      throw new Error('Onboarding state was not updated/saved correctly');
    }
    console.log('✅ Part C Success: Onboarding GET/PUT save and resume works perfectly.');

    // -------------------------------------------------------------
    // Part D Verification: Profile completion + publish
    // -------------------------------------------------------------
    console.log('\n--- VERIFYING PROFILE COMPLETION & PUBLISH (Part D) ---');

    // Check initial completion percentage (should be 0% as description, logo, products, hours, verified are missing)
    const getComp1 = await fetch(`${BASE_URL}/api/onboarding/completion`, { headers });
    const comp1 = await getComp1.json();
    console.log('Initial Completion percentage:', comp1.completion_percentage, '%');
    console.log('Missing actions:', comp1.missing_actions);
    if (comp1.completion_percentage !== 0) {
      throw new Error('Expected 0% completion initially');
    }

    // 1. Add description and opening hours to raise completion percentage
    console.log('Updating description and opening hours...');
    const updateProfileRes = await fetch(`${BASE_URL}/api/vendors/${vendor_id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        description: 'Trendy clothes and custom dresses',
        opening_hours: '9 AM - 6 PM'
      })
    });
    console.log('Profile update response:', await updateProfileRes.json());

    // Check completion percentage again (should have risen from 0% to 40% as 2 items are now checked)
    const getComp2 = await fetch(`${BASE_URL}/api/onboarding/completion`, { headers });
    const comp2 = await getComp2.json();
    console.log('Completion percentage after updating profile:', comp2.completion_percentage, '%');
    console.log('Missing actions:', comp2.missing_actions);
    if (comp2.completion_percentage !== 40) {
      throw new Error(`Expected 40% completion, got ${comp2.completion_percentage}%`);
    }

    // 2. Add a product to raise completion percentage to 60%
    console.log('Adding a product...');
    const prodRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vendor_id: vendor_id,
        name: 'Flowy Dress',
        category: 'Fashion',
        price: 150.00,
        stock: 5,
        description: 'Floral summer dress'
      })
    });
    console.log('Product creation response:', await prodRes.json());

    const getComp3 = await fetch(`${BASE_URL}/api/onboarding/completion`, { headers });
    const comp3 = await getComp3.json();
    console.log('Completion percentage after product:', comp3.completion_percentage, '%');
    console.log('Missing actions:', comp3.missing_actions);
    if (comp3.completion_percentage !== 60) {
      throw new Error(`Expected 60% completion, got ${comp3.completion_percentage}%`);
    }

    // 3. Test publish validation with complete minimum profile (which has name, category, and phone)
    console.log('Attempting to publish (should succeed)...');
    const pubRes = await fetch(`${BASE_URL}/api/onboarding/publish`, {
      method: 'POST',
      headers
    });
    const pubData = await pubRes.json();
    console.log('Publish response:', pubData);
    if (!pubData.published_at) {
      throw new Error('Expected profile to be successfully published');
    }

    // Check vendor's published field
    const vendorDetailsRes = await fetch(`${BASE_URL}/api/vendors/${vendor_id}`);
    const vendorDetails = await vendorDetailsRes.json();
    console.log('Vendor Published Status in DB:', vendorDetails.published, 'at', vendorDetails.published_at);
    if (vendorDetails.published !== 1) {
      throw new Error('Expected vendors.published column to be 1 in DB');
    }

    // 4. Test publish block on a vendor with incomplete minimum profile
    console.log('Creating a bad vendor to test publish block...');
    const badRegisterRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '', // Empty name!
        category: 'Other',
        phone: '',
        location: 'Space',
        email: 'bad_vendor@unity.com',
        password: 'password123'
      })
    });
    const badRegData = await badRegisterRes.json();

    const badLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bad_vendor@unity.com',
        password: 'password123'
      })
    });
    const badLoginData = await badLoginRes.json();
    const badToken = badLoginData.token;

    const badPubRes = await fetch(`${BASE_URL}/api/onboarding/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${badToken}`
      }
    });
    console.log('Bad vendor publish response (status):', badPubRes.status);
    const badPubData = await badPubRes.json();
    console.log('Bad vendor publish body:', badPubData);
    if (badPubRes.status !== 400 || !badPubData.error || !badPubData.missing_fields.includes('name')) {
      throw new Error('Expected publish to be blocked with 400 status and clear error listing missing fields');
    }
    console.log('✅ Part D Success: Completion calculation and publish endpoints validated perfectly.');

    // -------------------------------------------------------------
    // Part E Verification: Onboarding funnel events
    // -------------------------------------------------------------
    console.log('\n--- VERIFYING ONBOARDING FUNNEL EVENTS (Part E) ---');

    // Valid onboarding funnel event
    const validEventRes = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'started_registration' })
    });
    console.log('Valid event status:', validEventRes.status, await validEventRes.json());
    if (validEventRes.status !== 201) {
      throw new Error('Expected 201 for valid onboarding event');
    }

    // Invalid event type
    const invalidEventRes = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'clicked_something_invalid' })
    });
    console.log('Invalid event status:', invalidEventRes.status, await invalidEventRes.json());
    if (invalidEventRes.status !== 400) {
      throw new Error('Expected 400 for invalid event type');
    }
    console.log('✅ Part E Success: Allowed onboarding funnel event types accepted, unknown types rejected.');

    console.log('\n🎉 ALL END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY! 🎉');

  } catch (err) {
    console.error('\n❌ E2E VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    // Kill server
    server.kill();
    process.exit(0);
  }
}

run();
