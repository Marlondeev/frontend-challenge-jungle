import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus } from "lucide-react";
import type { User } from "@/domain/types";
import { useAuth } from "@/lib/auth";
import { useChangePassword, useUpdateProfile } from "@/lib/hooks";
import { errorMessage, fieldErrors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { AccountShell, Field, PasswordField } from "./account-ui";
import "@/styles/account.css";

type ProfileDraft = Pick<
  User,
  "displayName" | "username" | "email" | "walletAlias" | "ens"
>;
const profileFields = [
  "displayName",
  "username",
  "email",
  "walletAlias",
  "ens",
] as const;
const emptyProfile = (): ProfileDraft => ({
  displayName: "",
  username: "",
  email: "",
  walletAlias: "",
  ens: "",
});
const profileFromUser = (user: User): ProfileDraft => ({
  displayName: user.displayName,
  username: user.username,
  email: user.email,
  walletAlias: user.walletAlias,
  ens: user.ens,
});
interface ProfileScope {
  active: boolean;
  reader: FileReader | null;
}

export function ProfilePage() {
  const { user } = useAuth();
  const save = useUpdateProfile();
  const changePassword = useChangePassword();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<ProfileDraft>(emptyProfile);
  const serverProfile = useRef<{
    owner: string;
    fields: ProfileDraft;
  } | null>(null);
  const profileSubmission = useRef<{ owner: string } | null>(null);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const avatarScope = useRef<ProfileScope>({ active: false, reader: null });
  const [avatarReading, setAvatarReading] = useState(false);
  const [password, setPassword] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>(
    {},
  );
  const userId = user?.id;
  useEffect(() => {
    const scope: ProfileScope = { active: true, reader: null };
    avatarScope.current = scope;
    setAvatarReading(false);
    return () => {
      scope.active = false;
      if (scope.reader?.readyState === FileReader.LOADING) scope.reader.abort();
      scope.reader = null;
      profileSubmission.current = null;
    };
  }, [userId]);
  useEffect(() => {
    if (!user) {
      serverProfile.current = null;
      setProfile(emptyProfile());
      return;
    }
    const incoming = profileFromUser(user);
    const previous = serverProfile.current;
    const submitting = profileSubmission.current?.owner === user.id;
    serverProfile.current = { owner: user.id, fields: incoming };
    setProfile((current) => {
      if (previous?.owner !== user.id) return incoming;
      if (submitting) return current;
      const next = { ...current };
      let changed = false;
      for (const key of profileFields) {
        // Remote changes may refresh clean fields, but avatar/session updates
        // must not replace text the collector is still editing.
        if (
          current[key] === previous.fields[key] &&
          current[key] !== incoming[key]
        ) {
          next[key] = incoming[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [user]);
  const busy = save.isPending || changePassword.isPending || avatarReading;
  const owns = (originalOwner: string | undefined, scope: ProfileScope) =>
    !!originalOwner &&
    scope.active &&
    avatarScope.current === scope &&
    owner.current === originalOwner;
  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    const scope = avatarScope.current;
    if (busy || !userId || !owns(userId, scope)) return;
    const next: Record<string, string> = {};
    if (profile.displayName.trim().length < 2)
      next.displayName = "Informe seu nome de exibição.";
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(profile.username))
      next.username = "Use de 3 a 24 letras, números, pontos ou traços.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
      next.email = "Informe um e-mail válido.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const originalOwner = userId;
    const submitted = { ...profile };
    const submission = { owner: originalOwner };
    profileSubmission.current = submission;
    try {
      const saved = await save.mutateAsync(submitted);
      if (!owns(originalOwner, scope)) return;
      const confirmed = profileFromUser(saved);
      serverProfile.current = { owner: saved.id, fields: confirmed };
      setProfile((current) => {
        const updated = { ...current };
        for (const key of profileFields)
          if (current[key] === submitted[key]) updated[key] = confirmed[key];
        return updated;
      });
      notify("Perfil salvo.", "success");
    } catch (error) {
      if (!owns(originalOwner, scope)) return;
      setErrors(fieldErrors(error));
      notify(errorMessage(error), "error");
    } finally {
      if (profileSubmission.current === submission)
        profileSubmission.current = null;
    }
  }
  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    const scope = avatarScope.current;
    if (busy || !userId || !owns(userId, scope)) return;
    const originalOwner = userId;
    const next: Record<string, string> = {};
    if (!password.currentPassword)
      next.currentPassword = "Informe a senha atual.";
    if (
      password.newPassword.length < 8 ||
      !/[A-Z]/.test(password.newPassword) ||
      !/[0-9]/.test(password.newPassword)
    )
      next.newPassword = "Use 8 caracteres, uma letra maiúscula e um número.";
    if (password.newPassword !== password.confirmPassword)
      next.confirmPassword = "As senhas não coincidem.";
    setPasswordErrors(next);
    if (Object.keys(next).length) return;
    try {
      await changePassword.mutateAsync(password);
      if (!owns(originalOwner, scope)) return;
      setPassword({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      notify("Senha atualizada.", "success");
    } catch (error) {
      if (!owns(originalOwner, scope)) return;
      setPasswordErrors(fieldErrors(error));
      notify(errorMessage(error), "error");
    }
  }
  async function updateAvatar(file?: File) {
    const scope = avatarScope.current;
    if (!file || !userId || busy || !owns(userId, scope)) return;
    const originalOwner = userId;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      notify("Escolha uma imagem PNG, JPEG ou WebP de até 2 MB.", "error");
      if (avatarInput.current) avatarInput.current.value = "";
      return;
    }
    if (scope.reader?.readyState === FileReader.LOADING) scope.reader.abort();
    const reader = new FileReader();
    scope.reader = reader;
    const ownsRead = () =>
      owns(originalOwner, scope) && scope.reader === reader;
    setAvatarReading(true);
    try {
      const avatar = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onabort = () =>
          reject(new DOMException("Leitura cancelada", "AbortError"));
        reader.onerror = () =>
          reject(new Error("Não foi possível abrir a imagem."));
        reader.readAsDataURL(file);
      });
      if (!ownsRead()) return;
      await save.mutateAsync({ avatar });
      if (!ownsRead()) return;
      notify("Avatar atualizado.", "success");
    } catch (error) {
      if (
        !ownsRead() ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      notify(errorMessage(error), "error");
    } finally {
      if (ownsRead()) {
        setAvatarReading(false);
        if (avatarInput.current) avatarInput.current.value = "";
      }
      if (scope.reader === reader) scope.reader = null;
    }
  }
  return (
    <AccountShell active="profile">
      <h1>Perfil do colecionador</h1>
      <form onSubmit={submitProfile} noValidate>
        <div className="account-form-grid">
          {(
            [
              { key: "displayName", label: "Nome de exibição", required: true },
              { key: "username", label: "Nome de usuário", required: true },
              { key: "email", label: "E-mail", required: true },
              { key: "ens", label: "Nome ENS (opcional)" },
              { key: "walletAlias", label: "Apelido da carteira (opcional)" },
            ] as const
          ).map((field) => (
            <Field
              key={field.key}
              id={`profile-${field.key}`}
              label={field.label}
              required={"required" in field}
              type={field.key === "email" ? "email" : "text"}
              value={profile[field.key]}
              error={errors[field.key]}
              onChange={(e) =>
                setProfile((v) => ({ ...v, [field.key]: e.target.value }))
              }
            />
          ))}
          <div className="account-field">
            <label htmlFor="profile-avatar">Avatar</label>
            <div className="avatar-controls">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  className="profile-avatar"
                  alt="Seu avatar"
                />
              ) : (
                <div className="profile-avatar">
                  <ImagePlus size={22} />
                </div>
              )}
              <input
                ref={avatarInput}
                id="profile-avatar"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void updateAvatar(e.target.files?.[0])}
              />
              <Button
                type="button"
                disabled={busy}
                onClick={() => avatarInput.current?.click()}
              >
                Alterar
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !user?.avatar}
                onClick={async () => {
                  const originalOwner = userId;
                  const scope = avatarScope.current;
                  if (!owns(originalOwner, scope)) return;
                  try {
                    await save.mutateAsync({ avatar: "" });
                    if (!owns(originalOwner, scope)) return;
                    notify("Avatar removido.", "success");
                  } catch (error) {
                    if (!owns(originalOwner, scope)) return;
                    notify(errorMessage(error), "error");
                  }
                }}
              >
                Remover
              </Button>
            </div>
            <small>PNG, JPEG ou WebP. Até 2 MB.</small>
          </div>
        </div>
        <Button type="submit" disabled={busy}>
          {save.isPending ? "Salvando…" : "Salvar perfil"}
        </Button>
      </form>
      <form onSubmit={submitPassword} noValidate className="password-form">
        <h2>Alterar senha</h2>
        {(
          [
            { key: "currentPassword", label: "Senha atual" },
            { key: "newPassword", label: "Nova senha" },
            { key: "confirmPassword", label: "Confirmar nova senha" },
          ] as const
        ).map((field) => (
          <PasswordField
            key={field.key}
            id={`profile-${field.key}`}
            label={field.label}
            autoComplete={
              field.key === "currentPassword"
                ? "current-password"
                : "new-password"
            }
            value={password[field.key]}
            error={passwordErrors[field.key]}
            onChange={(e) =>
              setPassword((v) => ({ ...v, [field.key]: e.target.value }))
            }
          />
        ))}
        <Button type="submit" disabled={busy}>
          {changePassword.isPending ? "Salvando…" : "Salvar senha"}
        </Button>
      </form>
    </AccountShell>
  );
}
