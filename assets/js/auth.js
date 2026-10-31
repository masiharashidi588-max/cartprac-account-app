document.addEventListener("DOMContentLoaded", () => {
  const { sb, status } = window.CP;
  const statusEl = document.getElementById("formStatus");
  const google = document.querySelectorAll("[data-google-login]");
  async function googleLogin() {
    if (!sb) return status(statusEl,"Authentication is not configured yet. Complete the Supabase setup first.","error");
    const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin + "/account.html" } });
    if (error) status(statusEl,error.message,"error");
  }
  google.forEach(b=>b.addEventListener("click",googleLogin));

  const signup = document.getElementById("signupForm");
  const verify = document.getElementById("verifyForm");
  let pendingEmail = "";
  signup?.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!sb) return status(statusEl,"Authentication is not configured yet. Complete the Supabase setup first.","error");
    const email=document.getElementById("email").value.trim();
    const password=document.getElementById("password").value;
    const repeat=document.getElementById("repeatPassword").value;
    if(password!==repeat) return status(statusEl,"The passwords do not match.","error");
    if(password.length<10) return status(statusEl,"Use a password with at least 10 characters.","error");
    const button=signup.querySelector("button[type=submit]"); button.disabled=true; button.textContent="Creating account…";
    try {
      const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+"/account.html"}});
      if(error) throw error;
      pendingEmail=email;
      if(data.session) location.href="account.html?setup=1";
      else { signup.classList.add("hidden"); verify.classList.remove("hidden"); status(statusEl,"Check your inbox for the CartPrac verification code.","success"); }
    } catch(err){status(statusEl,err.message||"Could not create account.","error");}
    finally{button.disabled=false;button.textContent="Create account";}
  });
  verify?.addEventListener("submit",async e=>{
    e.preventDefault(); if(!sb) return;
    const token=document.getElementById("emailCode").value.trim();
    const button=verify.querySelector("button[type=submit]"); button.disabled=true;
    try { const {data,error}=await sb.auth.verifyOtp({email:pendingEmail,token,type:"signup"}); if(error) throw error; if(data.session) location.href="account.html?setup=1"; else status(statusEl,"Email verified. Please log in.","success"); }
    catch(err){status(statusEl,err.message||"Verification failed.","error");}
    finally{button.disabled=false;}
  });

  document.getElementById("loginForm")?.addEventListener("submit",async e=>{
    e.preventDefault(); if(!sb) return status(statusEl,"Authentication is not configured yet. Complete the Supabase setup first.","error");
    const email=document.getElementById("email").value.trim(),password=document.getElementById("password").value;
    const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;
    try {const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;location.href="account.html";}
    catch(err){status(statusEl,err.message||"Login failed.","error");}
    finally{button.disabled=false;}
  });
  document.getElementById("forgotForm")?.addEventListener("submit",async e=>{
    e.preventDefault(); if(!sb) return status(statusEl,"Authentication is not configured yet.","error");
    const email=document.getElementById("email").value.trim();
    try {const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/reset-password.html"});if(error)throw error;status(statusEl,"If the email is registered, a password-reset email has been sent.","success");}
    catch(err){status(statusEl,err.message||"Could not send reset email.","error");}
  });
  document.getElementById("resetForm")?.addEventListener("submit",async e=>{
    e.preventDefault();if(!sb)return status(statusEl,"Authentication is not configured yet.","error");
    const p=document.getElementById("password").value,r=document.getElementById("repeatPassword").value;
    if(p!==r)return status(statusEl,"The passwords do not match.","error");
    if(p.length<10)return status(statusEl,"Use at least 10 characters.","error");
    try {const {error}=await sb.auth.updateUser({password:p});if(error)throw error;status(statusEl,"Password updated. You can now log in.","success");}
    catch(err){status(statusEl,err.message||"Could not update password.","error");}
  });
});
