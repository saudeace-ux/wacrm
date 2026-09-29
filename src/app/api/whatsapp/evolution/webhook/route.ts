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

      // Attempt to resolve account_id from instance name (e.g., kyron_7c02cce4 -> user_id starts with 7c02cce4)
      let resolvedAccountId: string | null = null;
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
        }
      }

      if (!resolvedAccountId) {
        const { data: accounts } = await db.from('accounts').select('id').limit(1);
        resolvedAccountId = accounts?.[0]?.id || null;
      }

      for (const data of dataList) {
        const key = data.key;
        const isFromMe = key?.fromMe ?? false;
        const remoteJid = key?.remoteJid || '';
        
        // Skip group messages if desired or handle jids
        if (remoteJid.endsWith('@g.us')) {
          continue;
        }

        const phone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
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

        if (!phone || !messageContent) {
          continue;
        }

        // 1. Find or create contact
        let contactId: string | null = null;
        const { data: existingContact } = await db
          .from('contacts')
          .select('id, account_id')
          .eq('phone', phone)
          .maybeSingle();

        if (existingContact) {
          contactId = existingContact.id;
        } else if (resolvedAccountId) {
          const pushName = data.pushName || `WhatsApp ${phone.slice(-4)}`;
          const { data: newContact } = await db
            .from('contacts')
            .insert({
              phone,
              name: pushName,
              account_id: resolvedAccountId,
            })
            .select('id')
            .single();
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
        } else {
          const { data: contactRow } = await db
            .from('contacts')
            .select('account_id')
            .eq('id', contactId)
            .single();

          if (contactRow) {
            const { data: newConv } = await db
              .from('conversations')
              .insert({
                contact_id: contactId,
                account_id: contactRow.account_id,
                status: 'open',
                last_message_at: new Date().toISOString(),
                last_message_text: messageContent,
                unread_count: isFromMe ? 0 : 1,
              })
              .select('id')
              .single();
            conversationId = newConv?.id || null;
          }
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
          content_text: messageContent,
          message_type: 'text',
          direction: isFromMe ? 'outbound' : 'inbound',
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
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[evolution-webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

