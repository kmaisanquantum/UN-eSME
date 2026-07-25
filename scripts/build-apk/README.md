# Android APK (TWA) Build Documentation for Unity Mall

This guide documents how to produce an installable Android `.apk` package from the Unity Mall Progressive Web App (PWA) using standard tools.

## Important Platform Notice
- **Android:** The compiled and signed `.apk` file can be directly shared via WhatsApp, emails, or hosted download links. Recipients can download and install it immediately.
- **iOS:** iOS does not support side-loaded `.apk` installations. iOS users must visit the storefront (`/`) or the shareable install page (`/install.html`) in Safari and tap the **Share** button, then select **Add to Home Screen**.

---

## Method 1: Using Bubblewrap CLI (Recommended / Developer Method)

`bubblewrap` is a command-line tool maintained by the Google Chrome team to package PWAs as Android Packages using Trusted Web Activities (TWA).

### Prerequisites
1. **Node.js:** Version 16 or newer.
2. **Java Development Kit (JDK):** Version 11 or newer.
3. **Android SDK:** Command-line tools or Android Studio.

### Steps to Build

1. **Install Bubblewrap CLI globally:**
   ```bash
   npm install -g @bubblewrap/cli
   ```

2. **Initialize the Android Project:**
   Bubblewrap reads the PWA's web manifest to pre-configure the project. Run this in a fresh folder outside the repository:
   ```bash
   bubblewrap init --manifest=https://<your-unity-mall-domain>/manifest.webmanifest
   ```
   *Follow the prompts to configure app name, package name (e.g., `com.unitysme.mall`), and directory configurations.*

3. **Generate a Signing Key (Keystore):**
   When prompted by Bubblewrap during initial setup, opt to generate a new signing key.
   - **DO NOT commit this `.keystore` or `.jks` file to your Git repository.**
   - Keep the password and keystore file securely backed up. Losing this key means you cannot update your app in Google Play.

4. **Build the APK:**
   ```bash
   bubblewrap build
   ```
   *This downloads the required Gradle dependencies, builds the Android project, and outputs a signed, release-ready APK (e.g., `app-release-signed.apk`).*

---

## Method 2: Using PWABuilder (No-Code Method)

PWABuilder is an online portal backed by Microsoft to generate platform app bundles from web manifests.

1. Navigate to [PWABuilder](https://www.pwabuilder.com/).
2. Enter your PWA URL (e.g., `https://<your-unity-mall-domain>/`).
3. Once PWABuilder successfully analyzes your PWA and confirms your score is high, click **Build My App**.
4. Select **Android** and click **Download Package**.
5. PWABuilder will provide:
   - An installable `.apk` file for testing.
   - An `.aab` file for uploading to the Google Play Console.
   - Signing keys and instructions.

---

## Distribution
- **Via WhatsApp:** Send the signed `.apk` file directly to a WhatsApp chat. The recipient can tap it to install (they may need to allow "Install from Unknown Sources" on their device settings).
- **Via Download Link:** Upload the `.apk` file to your server or a cloud storage provider (Google Drive, S3, etc.) and put a "Download Android App" button on `/install.html`.
