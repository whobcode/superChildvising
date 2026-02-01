# Deployment Instructions

This document provides instructions on how to deploy the application to Cloudflare.

## Prerequisites

- A Cloudflare account.
- `npm` and `node.js` installed on your local machine.

## Step 1: Clone the Repository

Clone the repository to your local machine:

```bash
git clone <repository-url>
cd <repository-name>
```

## Step 2: Install Dependencies

Install the dependencies from the root of the project:

```bash
npm install
```

## Step 3: Set up Stream (WHIP/WHEP) and Cloudflare

This project uses Cloudflare Stream WebRTC via WHIP/WHEP for live streaming, and uses Cloudflare KV for tracking the active live input.

### A. Configure Cloudflare Stream
1. Ensure **Stream** is enabled for your Cloudflare account.
2. Create an **API Token** with permissions to manage Stream Live Inputs.
3. Note your **Account ID**.

### B. Configure Cloudflare
1.  Log in to your Cloudflare account and navigate to the **Workers & Pages** section.
2.  **Create a KV Namespace:**
    *   Go to the **KV** tab.
    *   Click **Create a namespace** and give it a name (e.g., `storm-meetings`).
    *   Note the **ID** of the namespace you just created.
3.  **Configure Worker Secrets:**
    *   Navigate to your worker (`storm-worker`) in the Cloudflare dashboard.
    *   Go to **Settings** -> **Variables**.
    *   Under **Environment Variables**, click **Add variable** for each of the following:
        *   `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.
        *   `CLOUDFLARE_API_TOKEN`: Your Cloudflare API Token.
    *   Make sure to **Encrypt** the API token for security.

## Step 4: Deploy the Worker

1.  Open `wrangler.jsonc` and update your bindings (KV/D1/R2) as needed.
2.  Deploy the Worker:

    ```bash
    npx wrangler deploy
    ```

## Step 5: Access the Application

Once the deployment is complete, you can access the application at the URL provided by Wrangler (e.g. `https://storm-worker.<your-subdomain>.workers.dev`).

## How the Application Works

The application is now split into two parts:

-   **Frontend**: The static assets (HTML, CSS, JS) are served by Cloudflare Pages.
-   **Backend**: The Cloudflare Worker handles the API requests for login, data collection, and data retrieval.

The frontend makes API requests to the Cloudflare Worker. The Worker uses a Cloudflare KV namespace to store the collected data.
