# Deployment Instructions

This document provides instructions on how to deploy the application to Cloudflare. This project uses Wrangler to deploy both the Worker and all static frontend assets in a single command.

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

## Step 3: Set up Cloudflare and RealtimeKit

This project requires a RealtimeKit account, a D1 Database, and an R2 Bucket.

### A. Configure RealtimeKit
1.  Go to the [RealtimeKit Developer Portal](https://dash.realtime.cloudflare.com/) and sign up for an account.
2.  Create a new project.
3.  In your project settings, find your **Organization ID** and generate an **API Key**.

### B. Configure Cloudflare
1.  Log in to your Cloudflare account.
2.  **Create a D1 Database:**
    *   Navigate to **Workers & Pages** > **D1**.
    *   Click **Create database**.
    *   Give it a name (e.g., `storm-db`) and note the **Database ID**.
    *   Go to the new database's console and run the following SQL to create the necessary table:
        ```sql
        CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, template TEXT, data TEXT);
        ```
3.  **Create an R2 Bucket:**
    *   Navigate to **R2**.
    *   Click **Create bucket**.
    *   Give it a name (e.g., `storm-bucket`) and follow the setup steps.

## Step 4: Configure and Deploy

1.  **Configure Worker Secrets:**
    *   This command will ask you to log in to your Cloudflare account if you haven't already.
    *   Run the following commands from the project root to set your RealtimeKit secrets. Wrangler will encrypt and store them securely.
    ```bash
    npx wrangler secret put REALTIMEKIT_ORG_ID
    # Paste your Organization ID when prompted
    
    npx wrangler secret put REALTIMEKIT_API_KEY
    # Paste your API Key when prompted
    ```

2.  **Configure Bindings:**
    *   Open the `wrangler.jsonc` file at the root of the project.
    *   Find the `d1_databases` section and replace `<your-d1-database-id>` with the actual ID of the D1 database you created.
    *   The `r2_buckets` and `kv_namespaces` sections should be correctly configured with the names you chose, but you can verify them here.

3.  **Deploy the Application:**
    *   Run the following command from the project root. This single command will deploy your Worker, apply database migrations, and upload all assets in the `public` directory.
    ```bash
    npx wrangler deploy
    ```

## Step 5: Access the Application

Once the deployment is complete, you can access the application at the URL provided by Wrangler (e.g., `https://storm-worker.<your-subdomain>.workers.dev`).
- The admin panel will be at `/panel.html`.
