export type Account = "gmail" | "outlook" | "work";
export type Folder = "inbox" | "archive" | "trash";
export type Category = "" | "Needs reply" | "Waiting" | "Reference";
export type Message = {
  sender: string;
  address: string;
  date: string;
  text: string;
  html?: string;
};
export type Mail = {
  id: string;
  sender: string;
  subject: string;
  account: Account;
  time: string;
  important: boolean;
  unread: boolean;
  starred: boolean;
  folder: Folder;
  category: Category;
  review?: boolean;
  attachment?: string;
  messages: Message[];
};
export const accounts: Record<
  Account,
  { label: string; email: string; color: string }
> = {
  gmail: {
    label: "Gmail",
    email: "you@gmail.example",
    color: "var(--account-gmail)",
  },
  outlook: {
    label: "Outlook",
    email: "you@outlook.example",
    color: "var(--account-outlook)",
  },
  work: {
    label: "Work IMAP",
    email: "you@work.example",
    color: "var(--account-work)",
  },
};
export const initialMail: Mail[] = [
  {
    id: "1",
    sender: "Maya Chen",
    subject: "A few ideas for the weekend",
    account: "gmail",
    time: "10:42",
    important: true,
    unread: true,
    starred: false,
    folder: "inbox",
    category: "Needs reply",
    messages: [
      {
        sender: "You",
        address: "you@gmail.example",
        date: "Yesterday, 18:24",
        text: "Hey Maya,\n\nShall we get out of the city this weekend? A walk, good coffee, and absolutely no plans sounds about right.\n\nLet me know what you think!",
      },
      {
        sender: "Maya Chen",
        address: "maya@example.com",
        date: "Today, 10:42",
        text: "Hey!\n\nThat sounds like exactly what I need. I found a little café near the lake that looks lovely. We could meet there around eleven and see where the afternoon takes us.\n\nSaturday works best for me. Does that work for you?\n\nMaya",
      },
    ],
  },
  {
    id: "2",
    sender: "Alex Morgan",
    subject: "Updated notes for Monday",
    account: "work",
    time: "09:58",
    important: true,
    unread: true,
    starred: true,
    folder: "inbox",
    category: "",
    attachment: "Monday notes.pdf",
    messages: [
      {
        sender: "Alex Morgan",
        address: "alex@work.example",
        date: "Today, 09:58",
        text: "Good morning,\n\nI’ve attached the updated notes for Monday. The agenda is on the first page, and I’ve added the open questions at the end.\n\nCould you take a look before our meeting?\n\nThanks,\nAlex",
      },
    ],
  },
  {
    id: "3",
    sender: "Studio North",
    subject: "Your order is on its way",
    account: "outlook",
    time: "09:16",
    important: true,
    unread: false,
    starred: false,
    folder: "inbox",
    category: "Reference",
    messages: [
      {
        sender: "Studio North",
        address: "hello@studio.example",
        date: "Today, 09:16",
        text: "A little something to look forward to.\n\nYour order has left our studio. We expect it to arrive early next week.\n\nThank you for choosing something made with care.\n\nStudio North",
        html: '<div style="padding:12px 4px"><p style="font-size:10px;letter-spacing:3px">STUDIO NORTH</p><h2>A little something<br>to look forward to.</h2><p>Your order has left our studio. We expect it to arrive early next week.</p><p>Thank you for choosing something made with care.</p><p><strong>Studio North</strong></p><img src="https://images.example/tracking.png" alt="A note from the studio"></div>',
      },
    ],
  },
  {
    id: "4",
    sender: "Sam Rivera",
    subject: "Re: Dinner next Thursday?",
    account: "gmail",
    time: "Yesterday",
    important: true,
    unread: false,
    starred: false,
    folder: "inbox",
    category: "Waiting",
    messages: [
      {
        sender: "Sam Rivera",
        address: "sam@example.com",
        date: "Yesterday, 19:12",
        text: "Thursday sounds good!\n\nI’ll check with Jamie and send you a couple of places tomorrow. Somewhere small and a little quieter this time?\n\nSam",
      },
    ],
  },
  {
    id: "5",
    sender: "Google Calendar",
    subject: "Invitation: Design catch-up",
    account: "gmail",
    time: "Yesterday",
    important: true,
    unread: false,
    starred: false,
    folder: "inbox",
    category: "",
    messages: [
      {
        sender: "Google Calendar",
        address: "calendar@example.com",
        date: "Yesterday, 15:30",
        text: "Design catch-up\n\nMonday, 19 October · 10:00–10:30\n\nA quick catch-up on the latest ideas and next steps.\n\nThis is a sample invitation for the design preview.",
      },
    ],
  },
  {
    id: "6",
    sender: "Lena Fischer",
    subject: "Photos from the coast",
    account: "gmail",
    time: "Thu",
    important: true,
    unread: false,
    starred: true,
    folder: "inbox",
    category: "",
    attachment: "Coast photos.zip",
    messages: [
      {
        sender: "Lena Fischer",
        address: "lena@example.com",
        date: "Thursday, 16:08",
        text: "Finally got around to putting these together.\n\nThere are a few really good ones from the last evening. That light was something else.\n\nHope they bring back a little of the sea air.\n\nLena",
      },
    ],
  },
  {
    id: "7",
    sender: "Daniel Park",
    subject: "Thanks for the introduction",
    account: "outlook",
    time: "Thu",
    important: true,
    unread: false,
    starred: false,
    folder: "inbox",
    category: "",
    messages: [
      {
        sender: "Daniel Park",
        address: "daniel@example.com",
        date: "Thursday, 11:03",
        text: "Just a quick thank you for connecting us.\n\nWe had a great conversation this morning. I really appreciate you thinking of it.\n\nAll the best,\nDaniel",
      },
    ],
  },
  {
    id: "8",
    sender: "The Sunday Edit",
    subject: "Small things, thoughtfully chosen",
    account: "outlook",
    time: "08:00",
    important: false,
    unread: true,
    starred: false,
    folder: "inbox",
    category: "",
    messages: [
      {
        sender: "The Sunday Edit",
        address: "editor@example.com",
        date: "Today, 08:00",
        text: "This week’s collection\n\nA few things to read, make, and come back to. Thank you for taking a little time with us.\n\nThe Sunday Edit",
      },
    ],
  },
  {
    id: "9",
    sender: "Unknown sender",
    subject: "An invitation for you",
    account: "gmail",
    time: "Yesterday",
    important: false,
    unread: true,
    starred: false,
    folder: "inbox",
    category: "",
    review: true,
    messages: [
      {
        sender: "Unknown sender",
        address: "invite@example.com",
        date: "Yesterday, 12:40",
        text: "Hello,\n\nWe’d like to invite you to our community event next month. Let us know if you’d like the details.\n\nThis sample message illustrates an uncertain relevance classification.",
      },
    ],
  },
  {
    id: "10",
    sender: "Nextcloud",
    subject: "Your weekly activity",
    account: "gmail",
    time: "Wed",
    important: false,
    unread: false,
    starred: false,
    folder: "inbox",
    category: "",
    messages: [
      {
        sender: "Nextcloud",
        address: "cloud@example.com",
        date: "Wednesday, 17:00",
        text: "Your files, up to date.\n\nHere is a summary of this week’s activity. Everything is in sync.\n\nNextcloud",
      },
    ],
  },
];
export type Draft = {
  id: string;
  account: Account;
  to: string;
  subject: string;
  body: string;
  updated: number;
  files?: string[];
};
export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  end: string;
  calendar: "Personal" | "Work";
  notes: string;
};
export const initialEvents: CalendarEvent[] = [
  {
    id: "e1",
    title: "Coffee by the lake",
    date: "2026-10-17",
    time: "11:00",
    end: "12:00",
    calendar: "Personal",
    notes: "Meet Maya at the café.",
  },
  {
    id: "e2",
    title: "Design catch-up",
    date: "2026-10-19",
    time: "10:00",
    end: "10:30",
    calendar: "Work",
    notes: "Review ideas and next steps.",
  },
  {
    id: "e3",
    title: "Dinner with Sam",
    date: "2026-10-22",
    time: "19:00",
    end: "21:00",
    calendar: "Personal",
    notes: "",
  },
  {
    id: "e4",
    title: "A little time outside",
    date: "2026-10-24",
    time: "09:30",
    end: "11:00",
    calendar: "Personal",
    notes: "",
  },
  {
    id: "e5",
    title: "Planning session",
    date: "2026-10-27",
    time: "14:00",
    end: "15:00",
    calendar: "Work",
    notes: "",
  },
];
