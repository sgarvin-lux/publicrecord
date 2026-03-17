# PublicRecord

Healthcare transparency platform bringing accountability through public data. Built with open data from CMS, HCRIS cost reports, and other public sources.

## Tech Stack

- **Framework:** Next.js (App Router) + TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL + PostGIS)
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage
- **Hosting:** Vercel
- **Maps:** Mapbox GL JS
- **Data Pipeline:** GitHub Actions (scheduled workflows)

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- A [Supabase](https://supabase.com) project with PostGIS enabled

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/sgarvin-lux/publicrecord.git
   cd publicrecord
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment variables template and fill in your values:

   ```bash
   cp .env.local.example .env.local
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting |
| `npm run type-check` | Run TypeScript type checking |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch and open a Pull Request

Ensure your code passes `npm run lint` and `npm run type-check` before submitting.

## License

MIT — see [LICENSE](LICENSE) for details.
