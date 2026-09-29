/**
 * Evolution API Client — manages instances, QR Code retrieval,
 * connection status, and outbound messaging for Kyron - CRM.
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://129.121.45.5:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

type EvolutionHeaders = Record<string, string>;

function getHeaders(): EvolutionHeaders {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

export interface InstanceConnectionState {
  state: 'open' | 'close' | 'connecting';
  instanceName: string;
}

export interface QrCodeResponse {
  pairingCode?: string;
  code?: string;
  base64?: string;
  count?: number;
  /** Non-null when the Evolution API call failed — carries a user-facing message. */
  error?: string;
}

/**
 * Configures the webhook URL for the instance in Evolution API.
 */
export async function configureEvolutionWebhook(instanceName: string): Promise<boolean> {
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kyroncrm.vercel.app';
    const webhookUrl = `${siteUrl.replace(/\/$/, '')}/api/whatsapp/evolution/webhook`;

    const res = await fetch(`${EVOLUTION_URL}/webhook/set/${instanceName}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
        },
      }),
    });

    return res.ok;
  } catch (err) {
    console.error('[evolution] Error configuring webhook:', err);
    return false;
  }
}

/**
 * Creates an instance if it doesn't already exist.
 */
export async function createEvolutionInstance(instanceName: string): Promise<boolean> {
  try {
    const res = await fetch(`${EVOLUTION_URL}/instance/create`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        instanceName,
        token: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });

    // Automatically ensure webhook is configured
    void configureEvolutionWebhook(instanceName);

    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    // If it already exists, that's fine
    if (res.status === 403 || data?.response?.message?.includes('already in use') || data?.message?.includes('already in use')) {
      return true;
    }
    console.error('[evolution] Failed to create instance:', data);
    return false;
  } catch (err) {
    console.error('[evolution] Error creating instance:', err);
    return false;
  }
}

/**
 * Connects to instance and retrieves the QR Code data (base64 string) or Pairing Code.
 */
export async function getEvolutionQrCode(instanceName: string, phoneNumber?: string): Promise<QrCodeResponse | null> {
  try {
    // Ensure instance is registered
    const created = await createEvolutionInstance(instanceName);
    if (!created) {
      return { error: 'Não foi possível criar/validar a instância na Evolution API. Verifique se a API key está correta.' };
    }

    let url = `${EVOLUTION_URL}/instance/connect/${instanceName}`;
    if (phoneNumber) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      if (cleanPhone) {
        url += `?number=${cleanPhone}`;
      }
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
      cache: 'no-store',
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error('[evolution] Failed to get QR/pairing code:', res.status, errorBody);
      if (res.status === 401 || res.status === 403) {
        return { error: `Autenticação falhou (HTTP ${res.status}). Verifique se a EVOLUTION_API_KEY está correta.` };
      }
      if (res.status === 404) {
        return { error: `Instância "${instanceName}" não encontrada (HTTP 404). A instância pode ter sido removida da Evolution API.` };
      }
      return { error: `Evolution API retornou erro HTTP ${res.status}. Verifique os logs do container.` };
    }

    const data = await res.json();
    
    // Normalize base64 image (ensure data:image/png;base64, prefix)
    let base64: string | undefined = undefined;
    const rawBase64 = data?.base64 || data?.qrcode?.base64;
    if (rawBase64 && typeof rawBase64 === 'string') {
      if (rawBase64.startsWith('data:image')) {
        base64 = rawBase64;
      } else if (rawBase64.length > 100) {
        base64 = `data:image/png;base64,${rawBase64}`;
      }
    }

    const pairingCode = data?.pairingCode || data?.qrcode?.pairingCode || data?.pairing_code || (phoneNumber ? data?.code : undefined);

    return {
      base64,
      pairingCode,
      code: data?.code,
      count: data?.count,
    };
  } catch (err) {
    console.error('[evolution] Error fetching QR code:', err);
    return { error: 'Erro de rede ao contactar a Evolution API na VPS. Verifique se o container está rodando.' };
  }
}

/**
 * Checks connection state ('open' means connected).
 */
export async function getEvolutionConnectionState(instanceName: string): Promise<InstanceConnectionState | null> {
  try {
    const res = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: getHeaders(),
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.instance || data;
  } catch (err) {
    console.error('[evolution] Error checking state:', err);
    return null;
  }
}

/**
 * Disconnects (logs out) the instance from WhatsApp.
 */
export async function logoutEvolutionInstance(instanceName: string): Promise<boolean> {
  try {
    const res = await fetch(`${EVOLUTION_URL}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.error('[evolution] Error logging out:', err);
    return false;
  }
}

/**
 * Sends a plain text message via Evolution API.
 */
export async function sendEvolutionText(instanceName: string, number: string, text: string) {
  // Format phone number to numbers only
  const cleanNumber = number.replace(/\D/g, '');

  const res = await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      number: cleanNumber,
      text,
    }),
  });

  if (!res.ok) {
    const errData = await res.text();
    throw new Error(`Evolution API send failed (${res.status}): ${errData}`);
  }

  return res.json();
}
