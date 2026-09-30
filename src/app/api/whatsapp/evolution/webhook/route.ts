import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/**
 * Webhook endpoint for Evolution API events:
 *   - MESSAGES_UPSERT: Incoming/Outgoing messages from WhatsApp
 *   - MESSAGES_UPDATE: Status updates (DELIVERY_ACK, READ, etc.)
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const eventName = String(payload.event || '').toUpperCase();
    const instanceName = String(payload.instance || '');
    const rawData = payload.data;

    if (!rawData) {
      return NextResponse.json({ ok: true, ignored: 'no data' });
    }

    // Evolution API can send data as a single object or an array
    const dataList = Array.isArray(rawData) ? rawData : [rawData];

    // Handle Incoming / Outgoing messages
    if (eventName === 'MESSAGES_UPSERT' || eventName === 'MESSAGES.UPSERT') {
      const db = supabaseAdmin();

      // Resolve account_id and user_id from instance name (e.g. kyron_7c02cce4 -> user_id starts with 7c02cce4)
      let resolvedAccountId: string | null = null;
      let resolvedUserId: string | null = null;
      const instanceHash = instanceName.replace(/^kyron_/, '');

      if (instanceHash) {
        const { data: profiles } = await db
          .from('profiles')
          .select('account_id, user_id');

        const matchedProfile = profiles?.find(
          (p) => p.user_id && p.user_id.replace(/-/g, '').startsWith(instanceHash)
        );
        if (matchedProfile) {
          resolvedAccountId = matchedProfile.account_id;
          resolvedUserId = matchedProfile.user_id;
        }
      }

      if (!resolvedAccountId || !resolvedUserId) {
        const { data: fallbackProfile } = await db
          .from('profiles')
          .select('account_id, user_id')
          .limit(1)
          .maybeSingle();

        resolvedAccountId = fallbackProfile?.account_id || null;
        resolvedUserId = fallbackProfile?.user_id || null;
      }

      for (const data of dataList) {
        const key = data.key;
        const isFromMe = key?.fromMe ?? false;
        const remoteJid = key?.remoteJid || '';
        
        // Skip group messages
        if (remoteJid.endsWith('@g.us')) {
          continue;
        }

        const cleanPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const phoneWithPlus = `+${cleanPhone}`;
        const messageId = key?.id;

        // Extract message text content across various message types
        const messageContent =
          data.message?.conversation ||
          data.message?.extendedTextMessage?.text ||
          data.message?.imageMessage?.caption ||
          data.message?.videoMessage?.caption ||
          (data.message?.imageMessage ? '[Imagem]' : '') ||
          (data.message?.audioMessage ? '[Áudio]' : '') ||
          (data.message?.documentMessage ? '[Documento]' : '') ||
          (data.message?.stickerMessage ? '[Sticker]' : '') ||
          (data.message?.contactMessage ? '[Contato]' : '') ||
          (data.message?.locationMessage ? '[Localização]' : '');

        if (!cleanPhone || !messageContent) {
          continue;
        }

        // 1. Find or create contact
        let contactId: string | null = null;
        const { data: existingContact } = await db
          .from('contacts')
          .select('id, account_id')
          .or(`phone.eq.${cleanPhone},phone.eq.${phoneWithPlus},phone_normalized.eq.${cleanPhone}`)
          .maybeSingle();

        const contactName = data.pushName || `WhatsApp ${cleanPhone.slice(-4)}`;

        if (existingContact) {
          contactId = existingContact.id;
        } else if (resolvedAccountId && resolvedUserId) {
          const { data: newContact, error: contactInsertErr } = await db
            .from('contacts')
            .insert({
              phone: phoneWithPlus,
              // phone_normalized is a generated column — do NOT insert it manually
              name: contactName,
              account_id: resolvedAccountId,
              user_id: resolvedUserId,
            })
            .select('id')
            .maybeSingle();
          if (contactInsertErr) {
            console.error('[evolution-webhook] Failed to create contact:', contactInsertErr.message);
          }
          contactId = newContact?.id || null;
        }

        if (!contactId) continue;

        // 2. Find or create conversation
        let conversationId: string | null = null;
        let unreadCount = 0;

        const { data: existingConv } = await db
          .from('conversations')
          .select('id, account_id, unread_count')
          .eq('contact_id', contactId)
          .maybeSingle();

        if (existingConv) {
          conversationId = existingConv.id;
          unreadCount = existingConv.unread_count || 0;
        } else if (resolvedAccountId && resolvedUserId) {
          const { data: newConv } = await db
            .from('conversations')
            .insert({
              account_id: resolvedAccountId,
              user_id: resolvedUserId,
              contact_id: contactId,
              status: 'open',
              last_message_at: new Date().toISOString(),
              last_message_text: messageContent,
              unread_count: isFromMe ? 0 : 1,
            })
            .select('id')
            .maybeSingle();
          conversationId = newConv?.id || null;
        }

        if (!conversationId) continue;

        // 3. Deduplicate message insertion
        if (messageId) {
          const { data: existingMsg } = await db
            .from('messages')
            .select('id')
            .eq('message_id', messageId)
            .maybeSingle();

          if (existingMsg) continue;
        }

        await db.from('messages').insert({
          conversation_id: conversationId,
          sender_type: isFromMe ? 'agent' : 'customer',
          content_type: 'text',
          content_text: messageContent,
          message_id: messageId || `evo_${Date.now()}`,
          status: isFromMe ? 'sent' : 'delivered',
          created_at: new Date().toISOString(),
        });

        // 4. Touch conversation timestamp, last message text & unread count
        await db
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_text: messageContent,
            unread_count: isFromMe ? 0 : unreadCount + 1,
          })
          .eq('id', conversationId);

        // 5. Ensure a Deal exists in the Pipeline for this contact
        if (resolvedAccountId && resolvedUserId) {
          const { data: existingDeal } = await db
            .from('deals')
            .select('id')
            .eq('contact_id', contactId)
            .maybeSingle();

          if (!existingDeal) {
            // Find first stage of the account's pipeline
            const { data: pipeline } = await db
              .from('pipelines')
              .select('id')
              .eq('account_id', resolvedAccountId)
              .limit(1)
              .maybeSingle();

            if (pipeline) {
              const { data: stage } = await db
                .from('pipeline_stages')
                .select('id')
                .eq('pipeline_id', pipeline.id)
                .order('position', { ascending: true })
                .limit(1)
                .maybeSingle();

              if (stage) {
                await db.from('deals').insert({
                  account_id: resolvedAccountId,
                  user_id: resolvedUserId,
                  contact_id: contactId,
                  conversation_id: conversationId,
                  pipeline_id: pipeline.id,
                  stage_id: stage.id,
                  title: contactName,
                  status: 'open',
                });
              }
            }
          }
        }
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[evolution-webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
