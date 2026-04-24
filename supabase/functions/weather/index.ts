export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/weather" || request.method !== "GET") {
      return new Response("Not found", { status: 404 });
    }

    const city = url.searchParams.get("city");
    if (!city) {
      return new Response(JSON.stringify({ error: "Cidade não informada" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API não configurada no servidor" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const weatherUrl = new URL(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
          city
        )}&units=metric&lang=pt_br&appid=${apiKey}`
      );

      const response = await fetch(weatherUrl.toString());
      const data = await response.json();

      if (data.cod !== 200) {
        return new Response(
          JSON.stringify({ error: data.message || "Erro ao buscar clima" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = {
        temp: Math.round(data.main.temp),
        feels_like: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
        city: data.name,
        country: data.sys.country,
        updated: new Date().toISOString(),
      };

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};