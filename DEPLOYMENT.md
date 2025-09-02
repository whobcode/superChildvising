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

Install the dependencies for the Cloudflare Worker:

```bash
cd worker
npm install
```

## Step 3: Create a Cloudflare Worker and KV Namespace

1.  Log in to your Cloudflare account and navigate to the **Workers & Pages** section.
2.  Click on **Create application** and then **Create Worker**.
3.  Give your Worker a name (e.g., `storm-worker`) and click on **Deploy**.
4.  Once the Worker is created, go to its settings and click on **Variables**.
5.  Scroll down to the **KV Namespace Bindings** section and click on **Add binding**.
6.  Enter `KV` as the **Variable name** and create a new KV namespace by clicking on the **Create a namespace** button. Give the namespace a name (e.g., `storm-kv`) and click on **Add**.

## Step 4: Deploy the Worker

1.  Open the `wrangler.toml` file in the `worker` directory. If it doesn't exist, create it with the following content:

    ```toml
    name = "storm-worker" # Replace with your worker name
    main = "index.js"
    compatibility_date = "2023-07-25"

    [[kv_namespaces]]
    binding = "KV"
    id = "<your-kv-namespace-id>" # Replace with your KV namespace ID
    ```

2.  You can find your KV namespace ID in the Cloudflare dashboard under **Workers & Pages** -> **KV**.

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

## How the Application Works

The application is now split into two parts:

-   **Frontend**: The static assets (HTML, CSS, JS) are served by Cloudflare Pages.
-   **Backend**: The Cloudflare Worker handles the API requests for login, data collection, and data retrieval.

The frontend makes API requests to the Cloudflare Worker. The Worker uses a Cloudflare KV namespace to store the collected data.
