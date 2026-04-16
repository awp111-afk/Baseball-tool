const https = require("https");

exports.handler = async function(event, context) {
  // Log everything so we can diagnose
  console.log("METHOD:", event.httpMethod);
  console.log("BODY TYPE:", typeof event.body);
  console.log("BODY VALUE:", event.body ? event.body.slice(0, 100) : "NULL/EMPTY");
  console.log("API KEY SET:", !!process.env.ANTHROPIC_API_KEY);
  console.log("API KEY LENGTH:", process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0);

  if (event.httpMethod !== "POST") {
    console.log("REJECTED: wrong method");
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Method not allowed" } })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("REJECTED: no API key");
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "API key not configured on server" } })
    };
  }

  let body = null;
  try {
    const rawBody = event.body;
    if (!rawBody || typeof rawBody !== "string" || rawBody.trim() === "") {
      console.log("REJECTED: empty body");
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: "Request body is empty" } })
      };
    }
    body = JSON.parse(rawBody);
  } catch (e) {
    console.log("REJECTED: JSON parse error:", e.message);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Invalid JSON in request body" } })
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    console.log("REJECTED: body not an object");
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Request body must be a JSON object" } })
    };
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    console.log("REJECTED: messages missing or not array. body keys:", Object.keys(body));
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "messages must be an array" } })
    };
  }

  console.log("REACHING ANTHROPIC: messages count:", body.messages.length);

  const payload = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: (typeof body.system === "string") ? body.system : "",
    messages: body.messages
  });

  return new Promise(function(resolve) {
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey
      }
    };

    const req = https.request(options, function(res) {
      let data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        console.log("ANTHROPIC STATUS:", res.statusCode);
        try {
          const parsed = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed)
          });
        } catch (e) {
          console.log("PARSE ERROR:", e.message);
          resolve({
            statusCode: 502,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: { message: "Unparseable response from Anthropic API" } })
          });
        }
      });
    });

    req.on("error", function(e) {
      console.log("NETWORK ERROR:", e.message);
      resolve({
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: "Network error: " + e.message } })
      });
    });

    req.setTimeout(25000, function() {
      req.destroy();
      console.log("TIMEOUT");
      resolve({
        statusCode: 504,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: "Request timed out" } })
      });
    });

    req.write(payload);
    req.end();
  });
};
