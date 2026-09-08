import ParticleText from "./ParticleText";

export function LoginScreen() {
  return (
    <main className="login">
      <div className="login-particle">
        <ParticleText
          text={"Alex bot,\nautonomous coding agent"}
          particleSize={2.1}
          density={4}
          color="#f4f7ff"
          highlightColor="#6ea8ff"
          scatter={180}
          gatherDuration={1500}
          stagger={380}
          pointerRepel={38}
          repelRadius={116}
          idleDrift={0.65}
          trigger="mount"
          fontSize="clamp(2rem, 7vw, 6.5rem)"
          fontWeight={700}
          glow
        />
      </div>
      <a className="login-signin" href="/auth/login">
        signin
      </a>
    </main>
  );
}
