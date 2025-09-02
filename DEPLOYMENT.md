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

## Step 3: Set up RealtimeKit and Cloudflare

This project requires a RealtimeKit account for the live streaming functionality and a Cloudflare KV Namespace for storing meeting information.

### A. Configure RealtimeKit
1.  Go to the [RealtimeKit Developer Portal](https://dash.realtime.cloudflare.com/) and sign up for an account.
2.  Create a new project.
3.  In your project settings, find your **Organization ID** and generate an **API Key**.

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
        *   `REALTIMEKIT_ORG_ID`: Your RealtimeKit Organization ID.
        *   `REALTIMEKIT_API_KEY`: Your RealtimeKit API Key.
    *   Make sure to **Encrypt** the API key for security.

## Step 4: Deploy the Worker

1.  Open the `worker/wrangler.toml` file. It should look like this:

    ```toml
    name = "storm-worker"
    main = "index.js"
    compatibility_date = "2023-07-25"

    [[kv_namespaces]]
    binding = "KV"
    id = "<your-kv-namespace-id>" # Paste the ID from Step 3B-2
    ```
2.  Replace `<your-kv-namespace-id>` with the actual ID of the KV namespace you created.
### B. Configure Cloudflare
1.  Log in to your Cloudflare account and navigate to the **Workers & Pages** section.
2.  **Create a KV Namespace:**
    *   Go to the **KV** tab.
    *   Click **Create a namespace** and give it a name (e.g., `storm-kv`).
    *   Note the **ID** of the namespace you just created.
3.  **Configure Worker Secrets:**
    *   Create a new worker by running `npx wrangler login` and `npx wrangler deploy` from the project root. This will create a worker named `storm-worker`.
    *   Navigate to your worker (`storm-worker`) in the Cloudflare dashboard.
    *   Go to **Settings** -> **Variables**.
    *   Under **Environment Variables**, click **Add variable** for each of the following:
        *   `REALTIMEKIT_ORG_ID`: Your RealtimeKit Organization ID.
        *   `REALTIMEKIT_API_KEY`: Your RealtimeKit API Key.
    *   Make sure to **Encrypt** the API key for security.

## Step 4: Configure and Deploy the Worker

1.  Open the `wrangler.jsonc` file at the root of the project.
2.  Find the `kv_namespaces` section and replace `<your-kv-namespace-id>` with the actual ID of the KV namespace you created in Step 3B-2.
3.  Deploy the Worker:
    ```bash
    npx wrangler deploy
    ```

## Step 5: Deploy the Static Assets to Cloudflare Pages

1.  Go to the **Workers & Pages** section in the Cloudflare dashboard and click on the **Pages** tab.
2.  Click on **Create a project** and select **Upload assets**.
3.  Give your project a name (e.g., `storm-frontend`) and drag and drop the `public` directory into the upload area.
4.  Click on **Deploy site**.

## Step 6: Access the Application

Once the deployment is complete, you can access the application at the URL provided by Cloudflare Pages.
- The admin panel will be at `https://<your-pages-project>.pages.dev/panel.html`.
- The API documentation will be at `https://<your-worker>.<your-subdomain>.workers.dev/docs`.
