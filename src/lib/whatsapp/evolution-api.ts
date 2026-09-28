/**
 * Evolution API Client — manages instances, QR Code retrieval,
 * connection status, and outbound messaging for Kyron - CRM.
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://129.121.45.5:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'kyron_crm_secret_key_123456';

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

    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    // If it already exists, that's fine
    if (res.status === 403 || data?.response?.message?.includes('already in use')) {
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
 * Connects to instance and retrieves the QR Code data (base64 string).
 */
export async function getEvolutionQrCode(instanceName: string): Promise<QrCodeResponse | null> {
  try {
    // Ensure instance is registered
    await createEvolutionInstance(instanceName);

    const res = await fetch(`${EVOLUTION_URL}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: getHeaders(),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error('[evolution] Failed to get QR code:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[evolution] Error fetching QR code:', err);
    return null;
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
