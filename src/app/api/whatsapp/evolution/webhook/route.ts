import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getEvolutionMediaBase64 } from '@/lib/whatsapp/evolution-api';

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

        if (!cleanPhone) {
          continue;
        }

        // Detect media types and content
        let contentType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
        let mediaUrl: string | null = null;
        let textContent: string | null = null;

        const imgMsg = data.message?.imageMessage;
        const audMsg = data.message?.audioMessage;
        const vidMsg = data.message?.videoMessage;
        const docMsg = data.message?.documentMessage;
        const stkMsg = data.message?.stickerMessage;

        if (imgMsg || stkMsg) {
          contentType = 'image';
          textContent = imgMsg?.caption || null;
        } else if (audMsg) {
          contentType = 'audio';
          textContent = null;
        } else if (vidMsg) {
          contentType = 'video';
          textContent = vidMsg?.caption || null;
        } else if (docMsg) {
          contentType = 'document';
          textContent = docMsg?.caption || docMsg?.fileName || docMsg?.title || null;
        } else {
          contentType = 'text';
          textContent =
            data.message?.conversation ||
            data.message?.extendedTextMessage?.text ||
            data.message?.contactMessage?.displayName ||
            data.message?.locationMessage?.name ||
            '';
        }

        // If it's a media message, retrieve the base64 media and upload to storage
        if (contentType !== 'text') {
          let base64String: string | null =
            data.base64 ||
            data.message?.base64 ||
            imgMsg?.base64 ||
            audMsg?.base64 ||
            vidMsg?.base64 ||
            docMsg?.base64 ||
            stkMsg?.base64 ||
            null;

          if (!base64String && instanceName) {
            base64String = await getEvolutionMediaBase64(instanceName, data);
          }

          if (base64String && resolvedAccountId) {
            try {
              const rawBase64 = base64String.replace(/^data:[^;]+;base64,/, '');
              const detectedMime =
                (base64String.match(/^data:([^;]+);base64,/)?.[1]) ||
                imgMsg?.mimetype ||
                audMsg?.mimetype ||
                vidMsg?.mimetype ||
                docMsg?.mimetype ||
                stkMsg?.mimetype ||
                (contentType === 'image'
                  ? 'image/jpeg'
                  : contentType === 'audio'
                  ? 'audio/ogg'
                  : contentType === 'video'
                  ? 'video/mp4'
                  : 'application/octet-stream');

              const ext =
                detectedMime.includes('jpeg') || detectedMime.includes('jpg')
                  ? 'jpg'
                  : detectedMime.includes('png')
                  ? 'png'
                  : detectedMime.includes('webp')
                  ? 'webp'
                  : detectedMime.includes('ogg')
                  ? 'ogg'
                  : detectedMime.includes('mp4')
                  ? 'mp4'
                  : detectedMime.includes('pdf')
                  ? 'pdf'
                  : 'bin';

              const buffer = Buffer.from(rawBase64, 'base64');
              const storagePath = `account-${resolvedAccountId}/inbound/${messageId || Date.now()}.${ext}`;

              const { error: uploadErr } = await db.storage
                .from('chat-media')
                .upload(storagePath, buffer, {
                  contentType: detectedMime,
                  cacheControl: '31536000, immutable',
                  upsert: true,
                });

              if (!uploadErr) {
                const { data: publicData } = db.storage
                  .from('chat-media')
                  .getPublicUrl(storagePath);
                mediaUrl = publicData?.publicUrl || null;
              } else {
                console.warn('[evolution-webhook] Storage upload warning:', uploadErr.message);
                mediaUrl = `data:${detectedMime};base64,${rawBase64}`;
              }
            } catch (mediaErr) {
              console.error('[evolution-webhook] Error processing media base64:', mediaErr);
              if (base64String) {
                mediaUrl = base64String.startsWith('data:')
                  ? base64String
                  : `data:image/jpeg;base64,${base64String}`;
              }
            }
          } else if (base64String) {
            mediaUrl = base64String.startsWith('data:')
              ? base64String
              : `data:image/jpeg;base64,${base64String}`;
          }
        }

        // If it's a plain text message and has no text content at all, skip
        if (contentType === 'text' && !textContent) {
          continue;
        }

        const previewText =
          textContent ||
          (contentType === 'image'
            ? '[Imagem]'
            : contentType === 'audio'
            ? '[Áudio]'
            : contentType === 'video'
            ? '[Vídeo]'
            : contentType === 'document'
            ? '[Documento]'
            : '');

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
              last_message_text: previewText,
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
            .select('id, media_url')
            .eq('message_id', messageId)
            .maybeSingle();

          if (existingMsg) {
            // If message exists but didn't have media_url, update it
            if (!existingMsg.media_url && mediaUrl) {
              await db
                .from('messages')
                .update({ media_url: mediaUrl, content_type: contentType })
                .eq('id', existingMsg.id);
            }
            continue;
          }
        }

        await db.from('messages').insert({
          conversation_id: conversationId,
          sender_type: isFromMe ? 'agent' : 'customer',
          content_type: contentType,
          content_text: textContent,
          media_url: mediaUrl,
          message_id: messageId || `evo_${Date.now()}`,
          status: isFromMe ? 'sent' : 'delivered',
          created_at: new Date().toISOString(),
        });

        // 4. Touch conversation timestamp, last message text & unread count
        await db
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_text: previewText,
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
