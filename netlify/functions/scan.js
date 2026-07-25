// This function runs on Netlify's servers (not in the browser).
// It receives a creator name, searches for leaked content via Serper.dev,
// and returns the results. Your API key stays hidden server-side.

const LEAK_TERMS = [
  "leaked",
  "onlyfans leaked",
  "onlyfans leak",
  "mega folder",
  "free onlyfans",
  "nudes leaked",
  "telegram leak",
];

// Official platforms — results from these are not leaks
const EXCLUDE_DOMAINS = [
  "onlyfans.com",
  "fansly.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "linktr.ee",
  "youtube.com",
  "facebook.com",
  "reddit.com",
  "google.com",
  "bing.com",
];

function buildQueries(name) {
  // Build 7 targeted search queries — enough to find leaks, cheap on API credits
  const queries = [];
  for (const term of LEAK_TERMS) {
    queries.push(`${name} ${term}`);
  }
  return queries;
}

function cleanDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

function isExcluded(domain) {
  return EXCLUDE_DOMAINS.some(
    (ex) => domain === ex || domain.endsWith("." + ex)
  );
}

async function searchSerper(query, apiKey) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid Serper API key. Check your SERPER_API_KEY in Netlify environment variables.");
    }
    throw new Error(`Serper error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.organic || []).map((item) => ({
    url: item.link || "",
    title: item.title || "",
    snippet: item.snippet || "",
  }));
}

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Parse the request
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const name = (body.name || "").trim();
  if (!name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Please enter a creator name." }),
    };
  }

  // Get API key from environment variable (set in Netlify dashboard)
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Scanner not configured. SERPER_API_KEY environment variable is missing.",
      }),
    };
  }

  try {
    const queries = buildQueries(name);
    const seen = new Set();
    const results = [];
    let errors = 0;

    // Run queries one by one with a small delay to avoid rate limits
    for (const query of queries) {
      try {
        const hits = await searchSerper(query, apiKey);
        for (const hit of hits) {
          const domain = cleanDomain(hit.url);
          if (!domain || isExcluded(domain)) continue;

          // Dedupe by domain+path
          const key = hit.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
          if (seen.has(key)) continue;
          seen.add(key);

          results.push({
            url: hit.url,
            domain: domain,
            title: hit.title,
            snippet: hit.snippet,
          });
        }
      } catch (e) {
        // If the API key is bad, stop immediately
        if (e.message.includes("Invalid Serper API key")) {
          return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message }),
          };
        }
        errors++;
      }

      // Small delay between queries
      await new Promise((r) => setTimeout(r, 300));
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        total: results.length,
        queries_run: queries.length,
        errors: errors,
        results: results,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || "Scan failed." }),
    };
  }
};
