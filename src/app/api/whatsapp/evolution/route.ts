import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getEvolutionQrCode,
  getEvolutionConnectionState,
  logoutEvolutionInstance,
} from '@/lib/whatsapp/evolution-api';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  // Use accountId or a standardized instance name per tenant/user
  const instanceName = searchParams.get('instance') || `kyron_${user.id.slice(0, 8)}`;

  if (action === 'status') {
    const state = await getEvolutionConnectionState(instanceName);
    return NextResponse.json({
      connected: state?.state === 'open',
      state: state?.state || 'close',
      instanceName,
    });
  }

  // Default: generate or fetch QR code
  const qrData = await getEvolutionQrCode(instanceName);
  const state = await getEvolutionConnectionState(instanceName);

  return NextResponse.json({
    instanceName,
    connected: state?.state === 'open',
    state: state?.state || 'close',
    qrCode: qrData?.base64 || null,
    pairingCode: qrData?.pairingCode || null,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const instanceName = body.instance || `kyron_${user.id.slice(0, 8)}`;
  const action = body.action;

  if (action === 'logout') {
    const success = await logoutEvolutionInstance(instanceName);
    return NextResponse.json({ success });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
