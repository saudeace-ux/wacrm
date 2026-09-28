import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/**
 * Webhook endpoint for Evolution API events:
 *   - MESSAGES_UPSERT: Incoming messages from WhatsApp contacts
 *   - MESSAGES_UPDATE: Status updates (DELIVERY_ACK, READ, etc.)
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const event = payload.event;
    const data = payload.data;

    if (!data) {
      return NextResponse.json({ ok: true, ignored: 'no data' });
    }

    // Handle Incoming / Outgoing messages
    if (event === 'messages.upsert') {
      const key = data.key;
      const isFromMe = key?.fromMe ?? false;
      const remoteJid = key?.remoteJid || '';
      const phone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      const messageId = key?.id;

      // Extract message text content
      const messageContent =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage?.caption ||
        data.message?.videoMessage?.caption ||
        (data.message?.imageMessage ? '[Imagem]' : '') ||
        (data.message?.audioMessage ? '[Áudio]' : '') ||
        (data.message?.documentMessage ? '[Documento]' : '');

      if (!phone || !messageContent) {
        return NextResponse.json({ ok: true, ignored: 'no content or phone' });
      }

      // 1. Find or create contact
      const db = supabaseAdmin();
      let contactId: string | null = null;
      const { data: existingContact } = await db
        .from('contacts')
        .select('id, account_id')
        .eq('phone', phone)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        // Fallback: pick the first account or one associated with instance
        const { data: accounts } = await db
          .from('accounts')
          .select('id')
          .limit(1);
        const accountId = accounts?.[0]?.id;

        if (accountId) {
          const pushName = data.pushName || `WhatsApp ${phone.slice(-4)}`;
          const { data: newContact } = await db
            .from('contacts')
            .insert({
              phone,
              name: pushName,
              account_id: accountId,
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }
      }

      if (!contactId) {
        return NextResponse.json({ ok: true, warning: 'contact not resolved' });
      }

      // 2. Find or create conversation
      let conversationId: string | null = null;
      const { data: existingConv } = await db
        .from('conversations')
        .select('id, account_id')
        .eq('contact_id', contactId)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
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
            })
            .select('id')
            .single();
          conversationId = newConv?.id || null;
        }
      }

      if (!conversationId) {
        return NextResponse.json({ ok: true, warning: 'conversation not resolved' });
      }

      // 3. Insert the message
      await db.from('messages').insert({
        conversation_id: conversationId,
        content_text: messageContent,
        message_type: 'text',
        direction: isFromMe ? 'outbound' : 'inbound',
        message_id: messageId,
        status: isFromMe ? 'sent' : 'delivered',
        created_at: new Date().toISOString(),
      });

      // 4. Touch conversation timestamp & snippet
      await db
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      return NextResponse.json({ success: true, conversationId });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[evolution-webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
