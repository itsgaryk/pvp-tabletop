<script>
   import { chat, publishToChat } from '$lib/stores/connection.js'
   import { solo } from '$lib/stores/solo.js'
   import { tick, afterUpdate } from 'svelte'

   let message = ''

   /*
      Two streams share this window: the game log (what happened on the board)
      and chat (what the players and spectators said). Only the chat stream can
      be written to, so the message box belongs to the Chat tab and is not on the
      window at all while the log is showing - writing needs the tab that reads
      it, and a box sitting there greyed out is a control that cannot be used and
      a rule to read instead of a place to type.

      In solo there is nobody to talk to, so the window shows the log alone: no
      tabs and no message box.
   */
   let tab = 'game'

   $: entries = $solo
      ? $chat.filter((entry) => entry.type !== 'chat')
      : $chat.filter((entry) => (tab === 'chat') === (entry.type === 'chat'))

   /*
      A message that arrives while the log is showing has nowhere to appear, so
      the Chat tab says so instead. The mark is set by comparing the stream with
      what was there when the tab was last looked at - `seen` is how many entries
      have been shown - which means it is raised once per new line rather than
      once per render, and a burst of messages is one glow rather than several.

      The count starts at whatever is already in the log, so opening a board on a
      game in progress does not light the tab for a conversation that happened
      before this browser arrived.

      Only chat is counted: the game log is not something a player needs to be
      called back for, and `type` is what tells the two apart.
   */
   let chatNode
   let seen = $chat.length
   let unread = false

   chat.subscribe((history) => {
      if (tab === 'chat') {
         seen = history.length
         unread = false
      } else {
         unread = history.length > seen && history.slice(seen).some((entry) => entry.type === 'chat')
      }
   })

   /* looking at the tab is what settles it, however the switch was made */
   $: if (tab === 'chat') unread = false

   function show (next) {
      tab = next
      if (next === 'chat') {
         unread = false
         seen = $chat.length
      }
   }

   function sendMessage () {
      if (!message) return
      publishToChat(message, 'chat')
      message = ''
   }

   function chatTime (time) {
      const format = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      return (new Date(time)).toLocaleTimeString([], format)
   }

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
         <button class:active={tab === 'game'} on:click={() => show('game')}>Game</button>
         <button class:active={tab === 'chat'} class:unread on:click={() => show('chat')}>Chat</button>
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

      <!--
         The message box is the Chat tab's, at the bottom of the window and only
         on the window while that tab is showing: it is part of the conversation,
         so it leaves with it rather than sitting under the game log.
      -->
      {#if !$solo && tab === 'chat'}
         <form class="composer" on:submit|preventDefault={sendMessage}>
            <input
               class="chat-input" type="text" name="message"
               placeholder="Type a message"
               on:keydown|stopPropagation bind:value={message}
               autocomplete="off">
            <button class="chat-button">Send</button>
         </form>
      {/if}
   </div>

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

   /*
      A message arrived while the log was showing. The same glow Setup uses on
      the Hide Pokemon button, so "this control wants you" reads the same way
      everywhere - and it stops the moment the tab is looked at.
   */
   .tabs button.unread {
      animation: chat-glow 1.1s ease-in-out infinite;
   }

   @keyframes chat-glow {
      0%, 100% { box-shadow: 0 0 0 rgba(250, 204, 21, 0); }
      50% { box-shadow: 0 0 12px 3px rgba(250, 204, 21, 0.9); }
   }

   .chat {
      @apply flex-1 flex flex-col p-2 border border-dark-50 rounded-md overflow-y-scroll bg-[var(--input-color)];
   }

   /*
      The message box lives inside the chat window, down at the bottom of it:
      `margin-top: auto` puts it there however few lines the conversation has, so
      the window does not change shape as messages arrive. It scrolls with the
      lines rather than floating over them, which is what makes it one window
      rather than a box under a list - and it is the Chat tab's alone (see the
      markup), so the Game tab has no greyed-out control to read.
   */
   .composer {
      @apply flex mt-auto pt-2;
   }

   .chat-input {
      @apply flex-1 p-2 border border-dark-50 border-r-0 rounded-l-md outline-none;
   }

   .chat-button {
      @apply py-2 px-3 font-bold text-white bg-[var(--primary-color)] border border-dark-50 border-l-0 rounded-r-md;
   }

   .opp-message {
      color: var(--message-color);
   }
</style>
