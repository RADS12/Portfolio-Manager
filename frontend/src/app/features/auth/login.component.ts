import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
      <div style="text-align:center;padding:40px;border:1px solid #ddd;border-radius:12px;max-width:360px;width:100%">
        <h1 style="margin-bottom:8px">PortfolioIQ</h1>
        <p style="color:#666;margin-bottom:24px">Login coming in next session</p>
        <a routerLink="/dashboard" style="padding:10px 24px;background:#1e3a5f;color:#fff;border-radius:6px;display:inline-block">
          Go to Dashboard →
        </a>
      </div>
    </div>
  `
})
export class LoginComponent {}
