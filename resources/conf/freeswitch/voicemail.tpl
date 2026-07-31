From: "@MAIL_FROM_NAME@" <@SMTP_FROM@>
Reply-To: "${voicemail_caller_id_name}" <${voicemail_caller_id_number}@${voicemail_domain}>
Date: ${RFC2822_DATE}
To: ${voicemail_email}
Subject: Voicemail from ${voicemail_caller_id_name} (${voicemail_caller_id_number}) - ${voicemail_message_len}
X-Priority: ${voicemail_priority}
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

New voicemail for ${voicemail_account}@${voicemail_domain}

  From:     ${voicemail_caller_id_name} (${voicemail_caller_id_number})
  Received: ${voicemail_time}
  Duration: ${voicemail_message_len}

The recording is attached. It also remains in your mailbox - dial *97 from your phone to
listen, or open the portal.
