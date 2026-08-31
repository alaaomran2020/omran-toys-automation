/**
 * Omran Toys Automation - server entry point.
 * Telegram + Webhook + Auth + Product Workflow + AI + SPA Assets
 */
import { loadConfig } from './config.js';
import { processEnvWithFile } from './lib/env.js';
import { createConsoleLogger } from './lib/logger.js';
import { openDatabase } from './db/database.js';
import { TelegramClient } from './telegram/client.js';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  TELEGRAM_BOT_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. معالجة مسارات الـ API أو الـ Webhook الخاص بتيليجرام
    if (url.pathname.startsWith("/api/")) {
      const path = url.pathname.replace("/api/", "");

      if (path === "webhook" && request.method === "POST") {
        try {
          const update: any = await request.json();
          
          if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || "";
            const photo = update.message.photo;

            if (photo && photo.length > 0) {
              const fileId = photo[photo.length - 1].file_id;
              // معالجة الصور الواردة
            } else if (text) {
              // معالجة النصوص الواردة
            }
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: "Omran Toys Automation API is active" 
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. توجيه باقي الطلبات للأصول الثابتة وتطبيقات الـ SPA عبر Cloudflare Assets Binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
