<script>
   import { chat, publishToChat } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import { tick, afterUpdate } from 'svelte'

   let message = ''

   /*
      Two streams share this window: the game log (what happened on the board)
      and chat (what the players and spectators said). Only the chat stream can
      be written to, so the box and button are locked while the log is showing.

      In solo there is nobody to talk to, so the window shows the log alone: no
      tabs and no message box.
   */
   let tab = 'game'

   $: entries = $solo
      ? $chat.filter((entry) => entry.type !== 'chat')
      : $chat.filter((entry) => (tab === 'chat') === (entry.type === 'chat'))
   $: locked = tab === 'game'

   function sendMessage () {
      if (locked || !message) return
      publishToChat(message, 'chat')
      message = ''
   }

   function chatTime (time) {
      const format = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      return (new Date(time)).toLocaleTimeString([], format)
   }

   let chatNode

   function autoscroll () {
      if (!chatNode) return
      chatNode.scrollTop = chatNode.scrollHeight
   }

   chat.subscribe(async () => {
      await tick()
      autoscroll()
   })

   /* switching tabs changes what is in the list, so scroll again */
   afterUpdate(autoscroll)
</script>

<div class="flex-1 flex flex-col gap-2 -mx-1 overflow-hidden">

   {#if !$solo}
      <div class="tabs">
         <button class:active={tab === 'game'} on:click={() => (tab = 'game')}>Game</button>
         <button class:active={tab === 'chat'} on:click={() => (tab = 'chat')}>Chat</button>
      </div>
   {/if}

   <div class="chat" bind:this={chatNode}>
      {#each entries as entry}
         <p>
            <span class="text-[var(--text-color-two)] text-sm font-">[{entry.name || (entry.self ? 'YOU' : 'OPP')}] {chatTime(entry.time)}</span>
            <span
               class:font-semibold={!entry.self}
               class:font-bold={entry.type === 'important'}
               class:italic={entry.type === 'important'}
               class:opp-message={entry.type === 'chat' && !entry.self}
               >{entry.message}</span>
         </p>
      {/each}
   </div>

   {#if !$solo}
      <form class="flex" on:submit|preventDefault={sendMessage}>
         <input
            class="chat-input" type="text" name="message"
            disabled={locked}
            placeholder={locked ? 'Switch to Chat to send a message' : ''}
            on:keydown|stopPropagation bind:value={message}
            autocomplete="off">
         <button class="chat-button" disabled={locked}>Send</button>
      </form>
   {/if}

</div>

<style>
   .tabs {
      @apply flex gap-1;
   }

   .tabs button {
      @apply px-3 py-1 text-sm font-bold rounded-md bg-[var(--bg-color-two)] text-[var(--text-color-two)];
   }

   .tabs button.active {
      @apply text-white bg-[var(--primary-color)];
   }

   .chat {
      @apply flex-1 p-2 border border-dark-50 rounded-md overflow-y-scroll bg-[var(--input-color)];
   }

   .chat-input {
      @apply flex-1 p-2 border border-dark-50 border-r-0 rounded-l-md outline-none;
   }

   .chat-input:disabled,
   .chat-button:disabled {
      @apply opacity-50 cursor-not-allowed;
   }

   .chat-button {
      @apply py-2 px-3 font-bold text-white bg-[var(--primary-color)] border border-dark-50 border-l-0 rounded-r-md;
   }

   .opp-message {
      color: var(--message-color);
   }
</style>
