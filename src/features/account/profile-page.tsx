import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useChangePassword, useUpdateProfile } from "@/lib/hooks";
import { errorMessage, fieldErrors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { AccountShell, Field, PasswordField } from "./account-ui";
import "@/styles/account.css";

export function ProfilePage() {
  const { user } = useAuth();
  const save = useUpdateProfile();
  const changePassword = useChangePassword();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState({
    displayName: "",
    username: "",
    email: "",
    walletAlias: "",
    ens: "",
  });
  const [password, setPassword] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    if (user)
      setProfile({
        displayName: user.displayName,
        username: user.username,
        email: user.email,
        walletAlias: user.walletAlias,
        ens: user.ens,
      });
  }, [user]);
  const busy = save.isPending || changePassword.isPending;
  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (profile.displayName.trim().length < 2)
      next.displayName = "Informe seu nome de exibição.";
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(profile.username))
      next.username = "Use de 3 a 24 letras, números, pontos ou traços.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
      next.email = "Informe um e-mail válido.";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync(profile);
      notify("Perfil salvo.", "success");
    } catch (error) {
      setErrors(fieldErrors(error));
      notify(errorMessage(error), "error");
    }
  }
  async function submitPassword(event: FormEvent) {
    event.preventDefault();
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
      setPassword({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      notify("Senha atualizada.", "success");
    } catch (error) {
      setPasswordErrors(fieldErrors(error));
      notify(errorMessage(error), "error");
    }
  }
  async function updateAvatar(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      notify("Escolha uma imagem PNG, JPEG ou WebP de até 2 MB.", "error");
      return;
    }
    try {
      const avatar = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Não foi possível abrir a imagem."));
        reader.readAsDataURL(file);
      });
      await save.mutateAsync({ avatar });
      notify("Avatar atualizado.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      if (avatarInput.current) avatarInput.current.value = "";
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
                  try {
                    await save.mutateAsync({ avatar: "" });
                    notify("Avatar removido.", "success");
                  } catch (error) {
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
