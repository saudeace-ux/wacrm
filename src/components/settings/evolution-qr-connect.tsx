'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  LogOut,
  Smartphone,
  ShieldCheck,
  Server,
  KeyRound,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function EvolutionQrConnect() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string>('');
  const [connectMethod, setConnectMethod] = useState<'qr' | 'pairing'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution?action=status');
      if (!res.ok) return;
      const data = await res.json();
      setConnected(data.connected);
      if (data.instanceName) setInstanceName(data.instanceName);
      if (data.connected) {
        setQrCode(null);
        setPairingCode(null);
        setErrorMsg(null);
      }
    } catch {
      // silent
    } finally {
      setChecking(false);
    }
  }, []);

  const loadConnectionData = async () => {
    if (connectMethod === 'pairing' && !phoneNumber.trim()) {
      toast.error('Informe o número do seu WhatsApp com DDD (ex: 5511999999999)');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      let url = '/api/whatsapp/evolution';
      if (connectMethod === 'pairing' && phoneNumber.trim()) {
        url += `?number=${encodeURIComponent(phoneNumber.replace(/\D/g, ''))}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.connected) {
        setConnected(true);
        setQrCode(null);
        setPairingCode(null);
        toast.success('WhatsApp já está conectado!');
      } else {
        setConnected(false);
        if (data.qrCode) {
          setQrCode(data.qrCode);
        }
        if (data.pairingCode) {
          setPairingCode(data.pairingCode);
        }

        if (!data.qrCode && !data.pairingCode) {
          setErrorMsg('A Evolution API na VPS não retornou o código. Verifique se o container docker na VPS está rodando.');
          toast.info('Aguardando resposta da Evolution API...');
        } else {
          toast.success(connectMethod === 'qr' ? 'QR Code gerado com sucesso!' : 'Código de pareamento gerado!');
        }
      }
      if (data.instanceName) setInstanceName(data.instanceName);
    } catch {
      setErrorMsg('Erro ao se comunicar com o servidor da Evolution API na VPS.');
      toast.error('Erro de conexão com a Evolution API.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Deseja realmente desconectar o WhatsApp desta sessão?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', instance: instanceName }),
      });
      if (res.ok) {
        setConnected(false);
        setQrCode(null);
        setPairingCode(null);
        toast.success('WhatsApp desconectado com sucesso.');
      }
    } catch {
      toast.error('Falha ao desconectar.');
    } finally {
      setLoading(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    toast.success('Código de pareamento copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    void checkStatus();
    const interval = setInterval(() => {
      void checkStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  if (checking) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Verificando conexão da Evolution API...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Conexão WhatsApp (Evolution API)
                </CardTitle>
                <Badge variant={connected ? 'default' : 'secondary'} className={connected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : ''}>
                  {connected ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Conectado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> Desconectado
                    </span>
                  )}
                </Badge>
              </div>
              <CardDescription>
                Conecte seu WhatsApp via QR Code ou Código de Pareamento sem burocracia ou taxas por mensagem.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkStatus}
                disabled={loading}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {connected ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-base font-medium text-foreground">WhatsApp Conectado com Sucesso!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Sua instância <span className="font-mono text-foreground font-semibold">{instanceName}</span> está ativa e pronta para enviar e receber mensagens no CRM.
                </p>
              </div>
              <div className="pt-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={loading}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Desconectar WhatsApp
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Method Selector Tabs */}
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <Button
                  type="button"
                  variant={connectMethod === 'qr' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setConnectMethod('qr')}
                  className="gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  QR Code
                </Button>
                <Button
                  type="button"
                  variant={connectMethod === 'pairing' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setConnectMethod('pairing')}
                  className="gap-2"
                >
                  <KeyRound className="h-4 w-4" />
                  Código de Pareamento (Celular)
                </Button>
              </div>

              {connectMethod === 'qr' ? (
                <div className="flex flex-col md:flex-row items-center justify-around gap-6 p-6 rounded-xl border border-border bg-card-2/50">
                  <div className="space-y-4 max-w-md">
                    <div className="flex items-center gap-3 text-primary">
                      <Smartphone className="h-6 w-6" />
                      <h4 className="font-medium text-foreground">Como conectar via QR Code:</h4>
                    </div>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>Abra o <strong>WhatsApp</strong> no seu celular.</li>
                      <li>Toque em <strong>Menu (três pontos)</strong> ou <strong>Configurações</strong>.</li>
                      <li>Selecione <strong>Aparelhos conectados</strong>.</li>
                      <li>Toque em <strong>Conectar um aparelho</strong> e aponte para o QR Code ao lado.</li>
                    </ol>

                    <div className="pt-2">
                      <Button
                        onClick={loadConnectionData}
                        disabled={loading}
                        className="w-full sm:w-auto"
                      >
                        {loading ? (
                          <span key="loading-state" className="inline-flex items-center" suppressHydrationWarning>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            <span suppressHydrationWarning>Gerando QR Code...</span>
                          </span>
                        ) : (
                          <span key="idle-state" className="inline-flex items-center" suppressHydrationWarning>
                            <QrCode className="h-4 w-4 mr-2" />
                            <span suppressHydrationWarning>{qrCode ? 'Atualizar QR Code' : 'Gerar QR Code'}</span>
                          </span>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* QR Code Container */}
                  <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-white shadow-sm">
                    {qrCode ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrCode}
                        alt="WhatsApp QR Code"
                        className="h-56 w-56 object-contain rounded-lg"
                      />
                    ) : (
                      <div className="h-56 w-56 flex flex-col items-center justify-center border border-dashed border-slate-300 rounded-lg text-slate-400 p-4 text-center">
                        <QrCode className="h-12 w-12 mb-2 stroke-[1.5]" />
                        <span className="text-xs" suppressHydrationWarning>
                          Clique em &quot;Gerar QR Code&quot; para exibir
                        </span>
                      </div>
                    )}
                    {qrCode && (
                      <span className="text-xs text-slate-500 mt-2 flex items-center gap-1" suppressHydrationWarning>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span suppressHydrationWarning>Aguardando leitura do celular...</span>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row items-center justify-around gap-6 p-6 rounded-xl border border-border bg-card-2/50">
                  <div className="space-y-4 max-w-md w-full">
                    <div className="flex items-center gap-3 text-primary">
                      <KeyRound className="h-6 w-6" />
                      <h4 className="font-medium text-foreground">Conectar com Código de Pareamento:</h4>
                    </div>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>Digite seu número de telefone abaixo (com DDD e código do país).</li>
                      <li>Clique em <strong>Gerar Código de Pareamento</strong>.</li>
                      <li>No WhatsApp do seu celular: <strong>Aparelhos Conectados</strong> &rarr; <strong>Conectar um aparelho</strong> &rarr; <strong>Conectar com número de telefone</strong>.</li>
                      <li>Insira o código exibido ao lado.</li>
                    </ol>

                    <div className="space-y-2 pt-2">
                      <Label htmlFor="phone-number" className="text-sm font-medium">Número do WhatsApp (com DDD)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="phone-number"
                          type="text"
                          placeholder="Ex: 5511999999999"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          disabled={loading}
                          className="font-mono text-sm"
                        />
                        <Button
                          onClick={loadConnectionData}
                          disabled={loading || !phoneNumber.trim()}
                          className="shrink-0"
                        >
                          {loading ? (
                            <span key="loading-pairing" className="inline-flex items-center" suppressHydrationWarning>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              <span suppressHydrationWarning>Gerando...</span>
                            </span>
                          ) : (
                            <span key="idle-pairing" className="inline-flex items-center" suppressHydrationWarning>
                              <KeyRound className="h-4 w-4 mr-2" />
                              <span suppressHydrationWarning>Gerar Código</span>
                            </span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Pairing Code Display Box */}
                  <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-border bg-card w-full max-w-xs text-center shadow-sm space-y-3">
                    <span className="text-xs text-muted-foreground font-medium">Código de Pareamento</span>
                    {pairingCode ? (
                      <div className="space-y-3 w-full">
                        <div className="text-2xl font-mono font-bold tracking-widest text-primary bg-primary/10 py-3 px-4 rounded-lg border border-primary/20 select-all">
                          {pairingCode}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyPairingCode}
                          className="w-full gap-2"
                        >
                          {copied ? (
                            <>
                              <Check className="h-4 w-4 text-emerald-500" />
                              Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              Copiar Código
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="h-28 flex flex-col items-center justify-center border border-dashed border-border rounded-lg text-muted-foreground p-4">
                        <KeyRound className="h-8 w-8 mb-2 opacity-50" />
                        <span className="text-xs">
                          Insira seu número e clique em &quot;Gerar Código&quot;
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm font-medium">Falha na resposta da VPS</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                {errorMsg}
              </AlertDescription>
            </Alert>
          )}

          <Alert className="bg-muted/50 border-border">
            <Server className="h-4 w-4" />
            <AlertTitle className="text-sm font-medium">Servidor Evolution API Conectado</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground mt-1">
              Conexão configurada para a sua VPS <code className="text-primary font-mono">http://129.121.45.5:8080</code>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
