import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// No login yet — interceptor just passes withCredentials for future auth.
// No token refresh or redirect logic until login is implemented.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }
  return next(req.clone({ withCredentials: true }));
};
