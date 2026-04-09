export default {
  async fetch(request, env, ctx) {
    // 1. Lida com CORS (para o painel conseguir enviar requisições sem erro do navegador)
    if (request.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        }
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
    };

    try {
      // 2. Extrai o Token JWT vindo da chamada do painel
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Você precisa estar logado (Falta token)" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      const token = authHeader.replace("Bearer ", "");
      
      // 3. Obtém dados do usuário no Supabase para garantir que é um usuário válido
      // Usamos getLocal para chamar a API de auth do seu Supabase
      const supabaseUserResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c21pcmhxYnNsbXZ5ZXNpa2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4NjMwOTYsImV4cCI6MjA3OTQzOTA5Nn0.ZLk6DAEfAZ2D451pGw1DO1h4oDIaZZgrgLOV6QUArB8"
        }
      });

      if (!supabaseUserResponse.ok) {
        return new Response(JSON.stringify({ error: "Sessão expirada ou usuário inválido" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const user = await supabaseUserResponse.json();

      // ============================================
      // LOGICA DE UPLOAD DIRECT
      // ============================================
      if (request.method === "POST" && request.url.includes("/upload")) {
        const contentType = request.headers.get("Content-Type") || "application/octet-stream";
        let ext = "bin";
        // Define a extensão baseada no tipo repassado
        if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
        else if (contentType.includes("png")) ext = "png";
        else if (contentType.includes("webp")) ext = "webp";
        else if (contentType.includes("mp4")) ext = "mp4";

        // Nome do arquivo protegido na raiz sob o ID do Usuário
        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;

        // Chamada NATIVA via BINDING (muito mais rápida e confiável)
        await env.MEDIA_BUCKET.put(fileName, request.body, {
          httpMetadata: {
            contentType: contentType
          }
        });

        const publicUrl = `${env.PUBLIC_R2_URL}/${fileName}`;

        console.log(`✅ Upload sucesso: ${publicUrl}`);

        return new Response(JSON.stringify({ url: publicUrl, path: fileName }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } 
      
      // ============================================
      // LOGICA DE EXCLUIR ARQUIVO
      // ============================================
      else if (request.method === "DELETE" && request.url.includes("/delete")) {
        const { path } = await request.json();
        
        // Proteção de segurança: Um usuário só pode apagar as TRILHAS/PASTAS dentro do seu ID
        if (!path.startsWith(`${user.id}/`)) {
          return new Response(JSON.stringify({ error: "Você não tem permissão para apagar esse arquivo" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        
        await env.MEDIA_BUCKET.delete(path);
        
        console.log(`🗑️ Deletado com sucesso: ${path}`);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } 
      
      // ============================================
      // METODO NÃO SUPORTADO
      // ============================================
      else {
         return new Response(JSON.stringify({ error: "Endpoint não suportado ou Método inválido" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
         });
      }
    } catch (error) {
      console.error(`🚨 Falha no R2 Worker: ${error.message}`);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
