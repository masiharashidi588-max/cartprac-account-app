document.addEventListener("DOMContentLoaded", async () => {
  const CP=window.CP, {sb,api,status,escapeHtml,avatarUrl}=CP;
  const statusEl=document.getElementById("accountStatus");
  const setup=document.getElementById("profileSetup"); const dashboard=document.getElementById("profileDashboard");
  if(!sb){status(statusEl,"Account authentication isn't configured yet. Finish the Supabase setup first.","error");return;}
  const {data:sessionData}=await sb.auth.getSession();
  if(!sessionData.session){location.href="login.html?next=account.html";return;}
  async function load(){
    try{
      const data=await api("/api/account/me");
      document.getElementById("accountEmail").textContent=data.email;
      if(!data.profile){setup.classList.remove("hidden");dashboard.classList.add("hidden");return;}
      setup.classList.add("hidden");dashboard.classList.remove("hidden");
      const p=data.profile;
      document.getElementById("accountName").textContent=p.username;
      document.getElementById("editUsername").value="";
      const publicLink=document.getElementById("publicProfileLink");
      if(publicLink) publicLink.innerHTML=p.profileVisibility==="public" ? `Public profile: <a class="accent" href="player.html?name=${encodeURIComponent(p.username)}">Open profile ↗</a>` : "Your profile is private. You can make it public in Profile settings.";
      document.getElementById("accountId").textContent=p.cartpracId;
      document.getElementById("profileVisibility").value=p.profileVisibility;
      document.getElementById("leaderboardVisibility").checked=p.leaderboardVisibility;
      document.getElementById("usernameChangeNote").textContent=p.usernameChangedAt?`Username changes are limited to once every 30 days.`:"You can change your username once every 30 days.";
      const img=document.getElementById("accountAvatar");
      if(p.hasUploadedAvatar){
        const blob=await api("/api/account/avatar");img.src=URL.createObjectURL(blob);
      }else img.src=avatarUrl(p.avatarPreset);
      const link=data.minecraft;
      document.getElementById("minecraftLinked").textContent=link?`Linked: ${link.player_name}`:"No Minecraft account linked";
      document.getElementById("minecraftLinkForm").classList.toggle("hidden",!!link);
      document.getElementById("unlinkMinecraft").classList.toggle("hidden",!link);
      const stats=document.getElementById("accountStats");
      if(data.stats){stats.innerHTML=[["Wins",data.stats.wins],["Losses",data.stats.losses],["Kills",data.stats.kills],["Deaths",data.stats.deaths]].map(([k,v])=>`<div class="card"><small class="soft">${k}</small><strong style="display:block;font-size:23px">${Number(v).toLocaleString()}</strong></div>`).join("");}
      else stats.innerHTML='<div class="notice" style="grid-column:1/-1">Statistics are not available in the current synchronized player sample yet.</div>';
      const achievements=document.getElementById("accountAchievements");
      if(achievements) achievements.innerHTML=(data.achievements||[]).map(a=>`<div class="card"><span class="badge ${a.unlocked?"green":""}">${a.unlocked?"UNLOCKED":"LOCKED"}</span><h3 style="margin-top:10px">${escapeHtml(a.title)}</h3><p class="small muted">${escapeHtml(a.description)}</p></div>`).join("") || '<div class="empty">Achievements appear when synced statistics are available.</div>';
    }catch(err){status(statusEl,err.message||"Could not load your account.","error");}
  }
  document.querySelectorAll("[data-avatar-preset]").forEach(button=>button.addEventListener("click",()=>{
    document.querySelectorAll("[data-avatar-preset]").forEach(b=>b.classList.remove("selected"));button.classList.add("selected");document.getElementById("accountAvatar").src=avatarUrl(button.dataset.avatarPreset);
  }));
  document.getElementById("createProfileForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;
    try{const preset=document.querySelector("[data-avatar-preset].selected")?.dataset.avatarPreset||"tnt";
      await api("/api/account/profile",{method:"POST",body:JSON.stringify({username:document.getElementById("newUsername").value.trim(),avatarPreset:preset,profileVisibility:"private",leaderboardVisibility:false})});
      status(statusEl,"Your CartPrac profile has been created.","success");await load();}
    catch(err){status(statusEl,err.message||"Could not create your profile.","error");}finally{button.disabled=false;}
  });
  document.getElementById("saveProfileForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;
    try{
      const preset=document.querySelector("[data-avatar-preset].selected")?.dataset.avatarPreset;
      const body={username:document.getElementById("editUsername").value.trim()||document.getElementById("accountName").textContent,
        profileVisibility:document.getElementById("profileVisibility").value,leaderboardVisibility:document.getElementById("leaderboardVisibility").checked};
      if(preset)body.avatarPreset=preset;
      await api("/api/account/profile",{method:"POST",body:JSON.stringify(body)});status(statusEl,"Profile settings saved.","success");await load();
    }catch(err){status(statusEl,err.message||"Could not save profile.","error");}finally{button.disabled=false;}
  });
  document.getElementById("avatarUpload")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;if(file.size>1024*1024){status(statusEl,"Choose an image no larger than 1 MB.","error");return;}
    try{await api("/api/account/avatar",{method:"POST",body:file,headers:{"Content-Type":file.type}});const savedAvatar=await api("/api/account/avatar");document.getElementById("accountAvatar").src=URL.createObjectURL(savedAvatar);status(statusEl,"Avatar uploaded.","success");}
    catch(err){status(statusEl,err.message||"Avatar upload failed.","error");}
  });
  document.getElementById("minecraftLinkForm")?.addEventListener("submit",async e=>{
    e.preventDefault();try{const code=document.getElementById("minecraftCode").value.trim().toUpperCase();await api("/api/account/minecraft/link",{method:"POST",body:JSON.stringify({code})});status(statusEl,"Minecraft account linked successfully.","success");await load();}
    catch(err){status(statusEl,err.message||"Could not link Minecraft account.","error");}
  });
  document.getElementById("unlinkMinecraft")?.addEventListener("click",async()=>{
    if(!confirm("Unlink your Minecraft account from CartPrac?"))return;
    try{await api("/api/account/minecraft/link",{method:"DELETE"});status(statusEl,"Minecraft account unlinked.","success");await load();}catch(err){status(statusEl,err.message,"error");}
  });
  document.getElementById("signOut")?.addEventListener("click",async()=>{await sb.auth.signOut();location.href="index.html";});
  document.getElementById("editUsername")?.addEventListener("focus",()=>{});
  await load();
});
